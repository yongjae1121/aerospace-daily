"""Aerospace Daily 빌드 스크립트 (표준 라이브러리만 사용).

사용법
  python scripts/build.py            강좌를 검사하고 data/course.js 생성
  python scripts/build.py --check    검사만 (파일 생성 안 함)
  python scripts/build.py --todo     지금 작성해야 할 Day 목록 출력
  python scripts/build.py --status   진행 현황 요약

강좌 하나 = content/lessons/NNN.md (본문) + content/lessons/NNN.json (메타·단어·지문·문제)
"""

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
LESSONS = CONTENT / "lessons"
OUT = ROOT / "data" / "course.js"
KST = dt.timezone(dt.timedelta(hours=9))

QUESTION_TYPES = {"mc", "ox", "num"}


def today_kst() -> dt.date:
    return dt.datetime.now(KST).date()


class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def err(self, where: str, msg: str):
        self.errors.append(f"[오류] {where}: {msg}")

    def warn(self, where: str, msg: str):
        self.warnings.append(f"[경고] {where}: {msg}")


# ---------------------------------------------------------------- 문자열 검사

MATH_SEG = re.compile(r"\$\$.+?\$\$|\$[^$]+\$", re.S)


def check_string(rep: Report, where: str, s: str, allow_newline: bool = False):
    """JSON 안 TeX의 역슬래시 실수(\\frac → 폼피드 등)를 잡아낸다."""
    for ch in s:
        if ord(ch) < 0x20 and not (allow_newline and ch == "\n"):
            rep.err(where, f"제어 문자 {ch!r} 발견 — JSON 안의 TeX는 역슬래시를 두 번 써야 합니다 (예: \"\\\\frac\", \"\\\\theta\").")
            return
    for seg in MATH_SEG.findall(s):
        if "\n" in seg:
            rep.err(where, "수식($...$) 안에 줄바꿈 발견 — \\nu, \\nabla 같은 명령은 JSON에서 \"\\\\nu\"처럼 써야 합니다.")
            return
    if s.count("$") % 2:
        rep.err(where, "$ 기호 개수가 홀수입니다 — 수식이 닫히지 않았습니다.")


def need_str(rep, where, obj, key, allow_newline=False, min_len=1):
    v = obj.get(key)
    if not isinstance(v, str) or len(v.strip()) < min_len:
        rep.err(where, f"'{key}'는 {min_len}자 이상의 문자열이어야 합니다.")
        return None
    check_string(rep, f"{where}.{key}", v, allow_newline)
    return v


# ---------------------------------------------------------------- 커리큘럼

def load_curriculum(rep: Report):
    path = CONTENT / "curriculum.json"
    try:
        cur = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        rep.err("curriculum.json", f"JSON을 읽을 수 없습니다: {e}")
        return None, {}
    try:
        dt.date.fromisoformat(cur["start"])
    except Exception:  # noqa: BLE001
        rep.err("curriculum.json", "'start'는 YYYY-MM-DD 형식이어야 합니다.")
    plan = {}
    unit_ids = set()
    for u in cur.get("units", []):
        uid = u.get("id", "?")
        if uid in unit_ids:
            rep.err("curriculum.json", f"단원 id 중복: {uid}")
        unit_ids.add(uid)
        for key in ("title", "title_en", "desc"):
            if not u.get(key):
                rep.err(f"curriculum.json {uid}", f"'{key}' 누락")
        for les in u.get("lessons", []):
            d = les.get("day")
            if not isinstance(d, int) or d < 1:
                rep.err(f"curriculum.json {uid}", f"잘못된 day 값: {d!r}")
                continue
            if d in plan:
                rep.err("curriculum.json", f"Day {d}가 두 번 나옵니다.")
            if not les.get("title") or not les.get("title_en"):
                rep.err(f"curriculum.json Day {d}", "title / title_en 누락")
            plan[d] = {**les, "unit": uid}
    days = sorted(plan)
    if days and days != list(range(1, days[-1] + 1)):
        missing = sorted(set(range(1, days[-1] + 1)) - set(days))
        rep.err("curriculum.json", f"Day 번호가 연속되지 않습니다. 빠진 Day: {missing[:10]}")
    return cur, plan


# ---------------------------------------------------------------- 문제

def check_question(rep: Report, where: str, q):
    if not isinstance(q, dict):
        rep.err(where, "문제는 객체여야 합니다.")
        return
    t = q.get("type")
    if t not in QUESTION_TYPES:
        rep.err(where, f"type은 {sorted(QUESTION_TYPES)} 중 하나여야 합니다 (현재: {t!r}).")
        return
    need_str(rep, where, q, "q", allow_newline=True, min_len=5)
    need_str(rep, where, q, "explain", allow_newline=True, min_len=5)
    if t == "mc":
        ch = q.get("choices")
        if not isinstance(ch, list) or not 3 <= len(ch) <= 5 or not all(isinstance(c, str) and c.strip() for c in ch):
            rep.err(where, "mc 문제의 choices는 3~5개의 문자열이어야 합니다.")
            return
        if len(set(ch)) != len(ch):
            rep.err(where, "choices에 중복된 보기가 있습니다.")
        for i, c in enumerate(ch):
            check_string(rep, f"{where}.choices[{i}]", c)
        a = q.get("answer")
        if not isinstance(a, int) or isinstance(a, bool) or not 0 <= a < len(ch):
            rep.err(where, f"answer는 0부터 시작하는 보기 번호여야 합니다 (0~{len(ch) - 1}).")
    elif t == "ox":
        if not isinstance(q.get("answer"), bool):
            rep.err(where, "ox 문제의 answer는 true 또는 false여야 합니다.")
    elif t == "num":
        a = q.get("answer")
        if not isinstance(a, (int, float)) or isinstance(a, bool):
            rep.err(where, "num 문제의 answer는 숫자여야 합니다.")
        tol = q.get("tol", 0.02)
        if not isinstance(tol, (int, float)) or not 0 < tol <= 0.2:
            rep.err(where, "tol(상대 허용 오차)은 0보다 크고 0.2 이하여야 합니다 (예: 0.02 = ±2%).")
        if "unit" in q and not isinstance(q["unit"], str):
            rep.err(where, "unit은 문자열이어야 합니다.")


# ---------------------------------------------------------------- 강좌

def check_lesson(rep: Report, day: int, plan_entry, data, body: str):
    w = f"Day {day:03d}"
    if data.get("day") != day:
        rep.err(w, f"JSON의 day 값({data.get('day')!r})이 파일 번호와 다릅니다.")
    need_str(rep, w, data, "title")
    need_str(rep, w, data, "title_en")
    need_str(rep, w, data, "summary", min_len=10)
    lvl = data.get("level")
    if not isinstance(lvl, int) or not 1 <= lvl <= 5:
        rep.err(w, "level은 1~5 정수여야 합니다.")
    mins = data.get("minutes")
    if not isinstance(mins, int) or not 5 <= mins <= 60:
        rep.err(w, "minutes는 5~60 정수여야 합니다.")

    obj = data.get("objectives")
    if not isinstance(obj, list) or not 2 <= len(obj) <= 5:
        rep.err(w, "objectives는 2~5개의 문자열 목록이어야 합니다.")
    else:
        for i, o in enumerate(obj):
            if not isinstance(o, str) or not o.strip():
                rep.err(w, f"objectives[{i}]가 비어 있습니다.")
            else:
                check_string(rep, f"{w}.objectives[{i}]", o)

    vocab = data.get("vocab")
    if not isinstance(vocab, list) or not 6 <= len(vocab) <= 12:
        rep.err(w, "vocab은 6~12개 단어여야 합니다.")
    else:
        seen = set()
        for i, v in enumerate(vocab):
            vw = f"{w}.vocab[{i}]"
            if not isinstance(v, dict):
                rep.err(vw, "단어는 객체여야 합니다.")
                continue
            for key in ("en", "ko", "pos", "def", "ex", "ex_ko"):
                need_str(rep, vw, v, key)
            if "pron" in v and not isinstance(v["pron"], str):
                rep.err(vw, "pron은 문자열이어야 합니다.")
            en = str(v.get("en", "")).lower()
            if en in seen:
                rep.err(vw, f"같은 단어가 두 번 나옵니다: {en}")
            seen.add(en)

    rd = data.get("reading")
    if not isinstance(rd, dict):
        rep.err(w, "reading(영어 지문) 객체가 필요합니다.")
    else:
        need_str(rep, f"{w}.reading", rd, "title")
        en = need_str(rep, f"{w}.reading", rd, "en", allow_newline=True, min_len=200)
        need_str(rep, f"{w}.reading", rd, "ko", allow_newline=True, min_len=80)
        if en:
            n = len(en.split())
            if not 80 <= n <= 400:
                rep.warn(f"{w}.reading", f"영어 지문이 {n}단어입니다 (권장 120~250).")

    for key, lo, hi in (("quiz", 3, 8), ("test", 2, 6)):
        qs = data.get(key)
        if not isinstance(qs, list) or not lo <= len(qs) <= hi:
            rep.err(w, f"{key}는 {lo}~{hi}개의 문제 목록이어야 합니다.")
            continue
        for i, q in enumerate(qs):
            check_question(rep, f"{w}.{key}[{i}]", q)

    fur = data.get("further", [])
    if not isinstance(fur, list):
        rep.err(w, "further는 목록이어야 합니다.")
    else:
        for i, f in enumerate(fur):
            if not isinstance(f, dict) or not f.get("title") or not str(f.get("url", "")).startswith("http"):
                rep.err(f"{w}.further[{i}]", "title과 http(s)로 시작하는 url이 필요합니다.")

    # 본문 마크다운
    if len(body.strip()) < 800:
        rep.err(w, f"본문(.md)이 너무 짧습니다 ({len(body.strip())}자). 최소 800자.")
    if "## " not in body:
        rep.err(w, "본문에 '## ' 소제목이 하나도 없습니다.")
    if body.count("$$") % 2:
        rep.err(w, "본문의 $$ 개수가 홀수입니다 — 블록 수식이 닫히지 않았습니다.")
    if body.count("<details") != body.count("</details>"):
        rep.err(w, "<details>와 </details>의 개수가 맞지 않습니다.")
    for m in re.finditer(r"<figure[\s\S]*?</figure>", body):
        if "\n\n" in m.group(0) or re.search(r"\n[ \t]*\n", m.group(0)):
            rep.err(w, "<figure> 안에 빈 줄이 있습니다 — 그림 HTML 안에는 빈 줄을 넣으면 안 됩니다.")
    if plan_entry and data.get("title") and data["title"] != plan_entry["title"]:
        rep.warn(w, f"제목이 커리큘럼과 다릅니다: '{data['title']}' vs '{plan_entry['title']}'")


def load_lessons(rep: Report, plan):
    lessons = {}
    if not LESSONS.exists():
        return lessons
    names = {p.stem for p in LESSONS.iterdir() if p.suffix in (".md", ".json")}
    for stem in sorted(names):
        if not re.fullmatch(r"\d{3}", stem):
            rep.err(f"content/lessons/{stem}", "파일 이름은 세 자리 숫자여야 합니다 (예: 012.json, 012.md).")
            continue
        day = int(stem)
        jp, mp = LESSONS / f"{stem}.json", LESSONS / f"{stem}.md"
        if not jp.exists() or not mp.exists():
            rep.err(f"Day {stem}", ".json과 .md 파일이 둘 다 있어야 합니다.")
            continue
        if day not in plan:
            rep.err(f"Day {stem}", "커리큘럼에 없는 Day입니다. 먼저 curriculum.json에 추가하세요.")
            continue
        try:
            data = json.loads(jp.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            rep.err(f"Day {stem}", f"JSON 문법 오류 (줄 {e.lineno}, 칸 {e.colno}): {e.msg}")
            continue
        body = mp.read_text(encoding="utf-8")
        check_lesson(rep, day, plan[day], data, body)
        lessons[day] = {**data, "body": body}
    return lessons


# ---------------------------------------------------------------- 출력

def day_date(cur, day: int) -> dt.date:
    return dt.date.fromisoformat(cur["start"]) + dt.timedelta(days=day - 1)


def build_bundle(cur, plan, lessons):
    units = []
    for u in cur["units"]:
        units.append({
            "id": u["id"], "icon": u.get("icon", ""), "title": u["title"],
            "title_en": u["title_en"], "desc": u["desc"],
            "lessons": [
                {"day": les["day"], "title": les["title"], "title_en": les["title_en"],
                 "topics": les.get("topics", []), "written": les["day"] in lessons}
                for les in u["lessons"]
            ],
        })
    return {
        "meta": {
            "title": cur.get("title", "Aerospace Daily"),
            "subtitle": cur.get("subtitle", ""),
            "start": cur["start"],
            "built": dt.datetime.now(KST).isoformat(timespec="minutes"),
            "total": len(plan),
            "written": len(lessons),
        },
        "units": units,
        "lessons": {str(d): lessons[d] for d in sorted(lessons)},
    }


def todo_days(cur, plan, lessons, ahead: int):
    limit = today_kst() + dt.timedelta(days=ahead)
    return [d for d in sorted(plan) if d not in lessons and day_date(cur, d) <= limit]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="검사만 하고 파일은 만들지 않음")
    ap.add_argument("--todo", action="store_true", help="작성이 필요한 Day 출력")
    ap.add_argument("--ahead", type=int, default=2, help="--todo: 오늘로부터 며칠 앞까지 미리 작성할지 (기본 2)")
    ap.add_argument("--status", action="store_true", help="진행 현황 요약")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    rep = Report()
    cur, plan = load_curriculum(rep)
    lessons = load_lessons(rep, plan) if cur else {}

    if args.todo or args.status:
        if cur is None:
            print("\n".join(rep.errors))
            sys.exit(1)
        today = today_kst()
        today_day = (today - dt.date.fromisoformat(cur["start"])).days + 1
        todo = todo_days(cur, plan, lessons, args.ahead)
        print(f"오늘(KST): {today}  →  Day {today_day}")
        print(f"작성된 강좌: {len(lessons)} / {len(plan)}")
        if args.todo:
            if todo:
                print("작성할 Day: " + ", ".join(str(d) for d in todo))
                for d in todo:
                    p = plan[d]
                    print(f"  - Day {d:03d} ({day_date(cur, d)}) [{p['unit']}] {p['title']} / {p['title_en']}")
            elif len(lessons) >= len(plan) and today_day + args.ahead > len(plan):
                print("커리큘럼의 모든 강좌가 작성되었습니다. CLAUDE.md의 '커리큘럼 확장' 절차에 따라 새 단원을 추가하세요.")
            else:
                print("작성할 Day 없음 (이미 충분히 앞서 있습니다).")
        if rep.errors:
            print(f"\n주의: 검사 오류 {len(rep.errors)}개가 있습니다. 'python scripts/build.py --check'로 확인하세요.")
        return

    for m in rep.warnings:
        print(m)
    if rep.errors:
        print("\n".join(rep.errors))
        print(f"\n검사 실패: 오류 {len(rep.errors)}개. 위 내용을 고친 뒤 다시 실행하세요.")
        sys.exit(1)

    print(f"검사 통과: 커리큘럼 {len(plan)}일, 작성된 강좌 {len(lessons)}개, 경고 {len(rep.warnings)}개")
    if args.check:
        return
    bundle = build_bundle(cur, plan, lessons)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    js = "window.COURSE = " + json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + ";\n"
    OUT.write_text(js, encoding="utf-8")
    print(f"생성: {OUT.relative_to(ROOT)} ({len(js.encode('utf-8')) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
