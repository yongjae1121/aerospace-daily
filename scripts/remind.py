"""학습 알림 발송 — GitHub Actions(.github/workflows/remind.yml)가 저녁 시간대에 매시간 실행.

Firestore users/{uid} 문서마다
  - remind.hour(기본 21시)가 지났고
  - 오늘 아직 알림을 보내지 않았고(remindSent)
  - 오늘(KST)의 강좌를 완료하지 않았으면
push.{기기ID}에 저장된 모든 기기로 웹 푸시를 보낸다.

환경 변수
  FIREBASE_SERVICE_ACCOUNT  서비스 계정 키 JSON (Firestore 관리자 읽기/쓰기)
  VAPID_PRIVATE_KEY         웹 푸시 VAPID 비밀 키 (PEM)
  REMIND_TEST=1             조건과 상관없이 모든 기기에 테스트 알림

로컬 점검: python scripts/remind.py --fixture docs.json --now 2026-10-21T21:05 --dry-run
"""

import argparse
import datetime as dt
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KST = dt.timezone(dt.timedelta(hours=9))
PROJECT = "aerospace-daily"
DATABASE = "default"
FIRESTORE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DATABASE}/documents"
SITE = "https://yongjae1121.github.io/aerospace-daily/"
VAPID_SUB = "https://yongjae1121.github.io"  # VAPID 연락처: mailto: 또는 경로 없는 https 주소만 허용됨
DEFAULT_HOUR = 21


def hour_text(h: int) -> str:
    return f"{'오전' if h < 12 else '오후'} {h - 12 if h > 12 else h}시"


# ---------------------------------------------------------------- Firestore REST 값 꺼내기

def fstr(fields: dict, key: str, default=None):
    return (fields.get(key) or {}).get("stringValue", default)


def fmap(fields: dict, key: str) -> dict:
    return ((fields.get(key) or {}).get("mapValue") or {}).get("fields") or {}


def fint(fields: dict, key: str, default=None):
    v = fields.get(key) or {}
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return int(v["doubleValue"])
    return default


# ---------------------------------------------------------------- 판단

def load_plan():
    cur = json.loads((ROOT / "content" / "curriculum.json").read_text(encoding="utf-8"))
    plan = {les["day"]: les for u in cur["units"] for les in u["lessons"]}
    return dt.date.fromisoformat(cur["start"]), plan


def streak_until_yesterday(active: list, today: dt.date) -> int:
    days, d, n = set(active), today - dt.timedelta(days=1), 0
    while d.isoformat() in days:
        n += 1
        d -= dt.timedelta(days=1)
    return n


def decide(doc: dict, now: dt.datetime, start: dt.date, plan: dict, test: bool):
    """(보낼 메시지 dict 또는 None, 이유 문자열)"""
    f = doc.get("fields", {})
    subs = {k: v.get("stringValue") for k, v in fmap(f, "push").items() if v.get("stringValue")}
    if not subs:
        return None, "알림 받는 기기 없음"
    hour = fint(fmap(f, "remind"), "hour", DEFAULT_HOUR)
    today = now.date()
    if test:
        return {"title": "🔔 알림 테스트", "body": f"알림이 잘 도착했어요! 공부를 안 한 날엔 {hour_text(hour)}에 알려 줄게요.", "url": SITE, "tag": "test"}, "테스트"
    if now.hour < hour:
        return None, f"아직 알림 시각({hour}시) 전"
    if fstr(f, "remindSent") == today.isoformat():
        return None, "오늘 이미 보냄"
    day = (today - start).days + 1
    if day < 1 or day not in plan:
        return None, f"커리큘럼 범위 밖(Day {day})"
    try:
        state = json.loads(fstr(f, "data", "{}"))
    except json.JSONDecodeError:
        state = {}
    done = state.get("done") or {}
    if str(day) in done or today.isoformat() in done.values():
        return None, "오늘 공부 완료"
    missed = sum(1 for d in range(1, day) if str(d) not in done)
    streak = streak_until_yesterday(state.get("active") or [], today)
    line2 = f"🔥 {streak}일 연속 기록이 이어지고 있어요. 오늘도 이어 가요!" if streak else "15~20분이면 충분해요. 지금 시작해 볼까요?"
    if missed:
        line2 += f" (밀린 강좌 {missed}개)"
    return {
        "title": "🚀 오늘의 강좌가 기다려요",
        "body": f"Day {day} · {plan[day]['title']}\n{line2}",
        "url": f"{SITE}#/lesson/{day}",
        "tag": "daily-reminder",
    }, f"Day {day} 미완료 → 발송"


# ---------------------------------------------------------------- 실행

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", help="Firestore 대신 읽을 문서 목록 JSON (점검용)")
    ap.add_argument("--now", help="현재 시각 대신 쓸 KST 시각 (예: 2026-10-21T21:05)")
    ap.add_argument("--dry-run", action="store_true", help="보내지 않고 판단만 출력")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    now = dt.datetime.fromisoformat(args.now).replace(tzinfo=KST) if args.now else dt.datetime.now(KST)
    test = os.environ.get("REMIND_TEST") == "1"
    start, plan = load_plan()
    print(f"현재 {now:%Y-%m-%d %H:%M} KST{' (테스트 모드)' if test else ''}")

    if args.fixture:
        docs, session = json.loads(Path(args.fixture).read_text(encoding="utf-8")), None
    else:
        sa = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
        if not sa:
            print("FIREBASE_SERVICE_ACCOUNT가 아직 설정되지 않아 건너뜁니다.")
            return
        from google.auth.transport.requests import AuthorizedSession
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_info(
            json.loads(sa), scopes=["https://www.googleapis.com/auth/datastore"])
        session = AuthorizedSession(creds)
        docs, params = [], {"pageSize": 300}
        while True:
            r = session.get(f"{FIRESTORE}/users", params=params, timeout=30)
            r.raise_for_status()
            j = r.json()
            docs += j.get("documents", [])
            if not j.get("nextPageToken"):
                break
            params["pageToken"] = j["nextPageToken"]

    send = None
    if not args.dry_run:
        pem = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
        if not pem:
            print("VAPID_PRIVATE_KEY가 없어 발송할 수 없습니다.")
            sys.exit(1)
        from pywebpush import WebPushException, webpush
        key_file = Path(tempfile.mkstemp(suffix=".pem")[1])
        key_file.write_text(pem + "\n", encoding="utf-8")

        def send(sub_json: str, msg: dict):
            sub = json.loads(sub_json)
            try:
                webpush(subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
                        data=json.dumps(msg, ensure_ascii=False), vapid_private_key=str(key_file),
                        vapid_claims={"sub": VAPID_SUB}, ttl=4 * 3600)
                return "ok"
            except WebPushException as e:
                code = getattr(e.response, "status_code", None)
                return "gone" if code in (404, 410) else f"error {code}: {str(e)[:120]}"

    print(f"사용자 문서 {len(docs)}개")
    failures = 0
    for doc in docs:
        uid = doc.get("name", "?").rsplit("/", 1)[-1]
        msg, why = decide(doc, now, start, plan, test)
        print(f"- {uid[:6]}…: {why}")
        if not msg or args.dry_run:
            continue
        subs = {k: v.get("stringValue") for k, v in fmap(doc.get("fields", {}), "push").items() if v.get("stringValue")}
        delivered = False
        for dev, sub_json in subs.items():
            result = send(sub_json, msg)
            print(f"    기기 {dev}: {result}")
            if result == "ok":
                delivered = True
            elif result == "gone" and session:
                # 만료된 구독(앱 삭제·권한 해제 등)은 지운다
                session.patch(f"https://firestore.googleapis.com/v1/{doc['name']}",
                              params={"updateMask.fieldPaths": f"push.`{dev}`"}, json={"fields": {}}, timeout=30)
            else:
                failures += 1
        if delivered and not test and session:
            session.patch(f"https://firestore.googleapis.com/v1/{doc['name']}",
                          params={"updateMask.fieldPaths": "remindSent"},
                          json={"fields": {"remindSent": {"stringValue": now.date().isoformat()}}}, timeout=30).raise_for_status()
    if failures:
        print(f"발송 실패 {failures}건")
        sys.exit(1)


if __name__ == "__main__":
    main()
