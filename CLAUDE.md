# Aerospace Daily — 작업 지침

매일 새 강좌가 자동으로 추가되는 항공우주공학 학습 사이트입니다. 학습자는 **과학고 2학년 학생**이고, 항공우주공학 진로를 준비하면서 **전공 영어 실력**도 함께 키우려 합니다. 학습자는 코딩을 하지 않으므로, 사이트 수정·강좌 작성은 모두 Claude가 맡습니다.

## 구조

```
index.html, assets/app.js, assets/style.css   정적 사이트 (빌드 도구 없음, 바닐라 JS)
content/curriculum.json                        160일 로드맵 (단원 → Day별 제목·주제)
content/lessons/NNN.md                         강좌 본문 (마크다운 + 수식 + 인라인 SVG)
content/lessons/NNN.json                       메타·영단어·영어 지문·문제
scripts/build.py                               검사 + data/course.js 생성 (표준 라이브러리만)
data/course.js                                 생성물 — 커밋하지 않음 (.gitignore)
assets/firebase-config.js                      기기 간 동기화용 Firebase 웹 설정 (null이면 동기화 꺼짐, Firestore DB ID는 "default")
firestore.rules                                Firestore 보안 규칙 (Firebase 콘솔에 붙여 넣은 것과 같게 유지)
.github/workflows/deploy.yml                   main에 push되면 검사 → GitHub Pages 배포
.github/workflows/merge-lessons.yml            claude/** 브랜치의 강좌를 main에 자동 병합
```

- Day N은 `curriculum.json`의 `start` 날짜 + (N−1)일에 사이트에서 열립니다(학습자 브라우저의 현지 날짜 기준).
- 7일마다 주간 테스트, 단원이 끝나면 단원 평가가 자동으로 생깁니다. 문제는 강좌 JSON의 `test`(+ `quiz`)와 `vocab`에서 뽑습니다.
- 진도·점수·단어 암기 상태는 브라우저 localStorage(`aerodaily.v1`)에 저장되고, Google 로그인 시 Firestore `users/{uid}` 문서(`data` = settings를 뺀 상태의 JSON 문자열)와 동기화됩니다. 쓰기는 항상 트랜잭션 안에서 원격과 `mergeState`로 병합합니다(완료는 최근 동작 우선, 테스트·학습일은 합집합, 단어는 복습 횟수가 많은 쪽). 상태 구조를 바꿀 때는 `mergeState`도 함께 고칩니다.

명령어:

```bash
python scripts/build.py           # 검사 + data/course.js 생성
python scripts/build.py --check   # 검사만
python scripts/build.py --todo    # 오늘(KST) + 2일까지 작성해야 할 Day 목록
python -m http.server 8000        # http://localhost:8000 에서 미리 보기
```

`python` 명령이 없는 환경(리눅스 클라우드 등)에서는 `python3`로 바꿔 실행합니다.

---

## 매일 강좌 작성 절차 (예약 루틴이 따르는 절차)

1. 최신 main을 받습니다: `git fetch origin && git checkout main && git pull --ff-only` (실패하면 현재 브랜치에서 그대로 진행).
2. `python scripts/build.py --todo`를 실행합니다.
   - "작성할 Day 없음"이면 **아무것도 바꾸지 말고 종료**합니다.
   - "커리큘럼의 모든 강좌가 작성되었습니다"이면 아래 **커리큘럼 확장**을 먼저 합니다.
3. 목록의 앞에서부터 **한 번에 최대 3개** Day를 작성합니다. Day마다:
   1. `content/curriculum.json`에서 그 Day의 `title`, `title_en`, `topics`, 소속 단원을 확인합니다. 제목은 커리큘럼과 똑같이 씁니다.
   2. 직전 강좌 2개의 `.md`를 읽어 흐름을 잇고(앞에서 배운 개념은 "Day N에서 배운 …"으로 연결), 내용 중복을 피합니다.
   3. 이미 쓴 영단어를 확인합니다: `grep -ho '"en": "[^"]*"' content/lessons/*.json | sort` — 같은 단어를 다시 쓰지 않습니다.
   4. `content/lessons/NNN.md`, `content/lessons/NNN.json`을 아래 규격대로 작성합니다 (NNN = 세 자리, 예: `012`).
   5. 수치 문제의 정답은 **반드시 Python으로 계산**해서 넣습니다 (`python -c "..."`).
   6. `python scripts/build.py --check`가 통과할 때까지 고칩니다.
   7. 아래 **품질 체크리스트**로 스스로 검토합니다.
4. 커밋하고 푸시합니다.
   ```bash
   git add content/
   git commit -m "lesson: Day 012 비추력"
   git push origin HEAD:main || git push -u origin HEAD
   ```
   - main에 직접 푸시가 거부되면 현재 브랜치(`claude/...`)로 푸시하면 됩니다. `merge-lessons.yml`이 검사 후 main에 병합하고 배포합니다. PR은 만들지 않아도 됩니다.
   - `data/course.js`는 커밋하지 않습니다. `content/` 밖의 파일(사이트 코드 등)은 루틴에서 **절대 수정하지 않습니다** — 자동 병합 워크플로가 거부합니다.
5. 마지막에 작성한 Day와 제목을 한두 줄로 보고합니다.

---

## 강좌 본문 규격 (`NNN.md`)

**말투와 수준**
- 한국어 해요체. 친근하지만 정확하게. 고2 이과 수준(미적분 기초, 역학, 벡터)을 전제로, 대학 1–2학년 내용까지 직관 → 식 → 숫자 예제 순서로 끌어올립니다.
- 전공 용어는 처음 나올 때 영어를 함께 씁니다: `**양력(lift)**`, `**비추력(specific impulse)**`.
- 읽는 시간 15–25분. 본문은 SVG를 빼고 한글 기준 약 3,000–6,000자.

**구성** (소제목은 `## `, 4–7개)
1. 흥미로운 질문이나 장면으로 시작 → 핵심 개념 설명 → 식 유도/의미 → 실제 비행체의 숫자
2. `> [!EXAMPLE]` 예제 1–2개 (풀이는 접기 상자)
3. `> [!THINK]` 생각해 보기 1개
4. 필요하면 `> [!HISTORY]`, `> [!FACT]`, `> [!CAREER]`, `> [!TIP]`, `> [!WARNING]`, `> [!NOTE]`
5. 마지막은 항상 `> [!KEY] 오늘의 핵심` (3–5개 항목)
6. 관련 있으면 한국 사례를 넣습니다: 누리호, 나로호, 다누리, KARI, 우주항공청(KASA), KAI, KF-21, 한화에어로스페이스 등.

**문법**
- 수식: 인라인 `$...$`, 블록 `$$...$$`(앞뒤 빈 줄, 또는 강조 박스 안에서는 `> $$...$$` 한 줄). KaTeX 문법. 수식 안 한글은 피하고 `\text{payload}`처럼 영어로.
- 돈은 `$` 대신 "달러"로 씁니다 (`$`는 수식 기호).
- 강조 박스:
  ```markdown
  > [!TIP] 제목(선택)
  > 내용 첫 줄
  > 내용 이어서
  ```
  종류: `NOTE` 참고, `TIP` 팁, `WARNING` 주의, `KEY` 핵심 정리, `FACT` 알고 있나요?, `HISTORY` 역사 이야기, `CAREER` 진로 노트, `THINK` 생각해 보기, `EXAMPLE` 예제
- 예제 풀이 (이 모양 그대로, 빈 `>` 줄 포함):
  ```markdown
  > [!EXAMPLE] 예제 1 — 제목
  > 문제 내용
  >
  > <details class="solution"><summary>풀이 보기</summary>
  >
  > 풀이 내용, $$...$$ 수식 가능
  >
  > </details>
  ```
- 표: GitHub 마크다운 표.
- 그림(선택, 도움이 될 때 1개 정도): 인라인 SVG.
  ```html
  <figure class="fig"><svg viewBox="0 0 560 260" role="img" aria-label="설명">
  <rect x="1" y="1" width="558" height="258" rx="12" class="bg"/>
  ... 선/화살표/글자 ...
  </svg><figcaption>그림 설명</figcaption></figure>
  ```
  - `<figure>` 안에는 **빈 줄 금지**, `$` 금지.
  - 색은 `stroke="currentColor"` / `fill="currentColor"`에 클래스로 지정: `a1`(파랑), `a2`(주황), `ok`(초록), `mut`(회색), 기본(본문색). 배경은 `class="bg"`. 글자는 `<text>`만 쓰면 테마 색이 자동 적용.
  - 화살표 머리는 `<path d="M끝점 L.. L.. Z">` 삼각형으로 직접 그립니다 (marker 쓰지 않기).
  - 좌표를 계산해서 글자와 선이 겹치지 않게 합니다. 축척을 무시했다면 캡션에 밝힙니다.

## 강좌 데이터 규격 (`NNN.json`)

```json
{
  "day": 12,
  "title": "커리큘럼과 같은 한국어 제목",
  "title_en": "Same English Title as Curriculum",
  "level": 2,
  "minutes": 20,
  "summary": "홈 화면 카드에 보일 1–2문장 요약",
  "objectives": ["~할 수 있다.", "~할 수 있다.", "~할 수 있다."],
  "vocab": [
    {"en": "specific impulse", "pron": "spəˈsɪfɪk ˈɪmpʌls", "pos": "n.", "ko": "비추력",
     "def": "쉬운 영어 정의 (20단어 이내)", "ex": "항공우주 맥락의 자연스러운 예문.", "ex_ko": "예문 번역"}
  ],
  "reading": {"title": "English Title", "en": "문단1\n\n문단2", "ko": "번역 문단1\n\n번역 문단2"},
  "quiz": [ ... 4문제 ... ],
  "test": [ ... 3문제 ... ],
  "further": [{"title": "NASA — ...", "url": "https://...", "lang": "en"}]
}
```

- `level` 1–5 (단원이 진행될수록 높게), `minutes` 15–25.
- **vocab**: 8개(6–12 허용). 이전 강좌에 나온 단어는 제외. `pron`은 IPA(슬래시 없이), `pos`는 `n.`, `v.`, `adj.`, `n. / v.` 등.
- **reading**: 직접 쓴 원문(복사 금지) 150–230단어, 2–3문단(`\n\n`으로 구분), 수준은 고급 고교~대학 교양(B2). 그날 vocab 중 4개 이상을 그대로(또는 복수형·과거형으로) 사용 — 사이트가 자동으로 밑줄을 칩니다. `ko`는 자연스러운 전체 번역.
- **문제 형식** (모든 문제에 `explain` 필수, 풀이 과정까지):
  - 객관식: `{"type": "mc", "q": "...", "choices": ["4개"], "answer": 0, "explain": "..."}` — `answer`는 0부터. 테스트에서 보기 순서가 섞이므로 "모두 정답", "위의 보기 모두", "①과 ②" 같은 보기는 금지.
  - O/X: `{"type": "ox", "q": "...", "answer": true, "explain": "..."}`
  - 계산: `{"type": "num", "q": "필요한 상수와 단위를 문제에 명시", "answer": 3.19, "tol": 0.02, "unit": "m/s²", "explain": "..."}` — `tol`은 상대 오차(0.02 = ±2%). 답이 퍼센트면 숫자만 입력하도록 문제에 "(숫자만 입력)"을 씁니다.
- **quiz** 4문제: 유형을 섞고, 주제가 허락하면 계산 문제 1개 이상. **마지막 문제는 영어 지문 독해 객관식(영어로 출제)**.
- **test** 3문제: quiz와 겹치지 않는, 조금 더 응용된 문제. 강좌 화면에는 안 보이고 주간 테스트·단원 평가에만 나옵니다. 가능하면 계산 문제 1개 포함.
- **further** 2–3개: NASA, ESA, KARI, 우주항공청, Wikipedia, Khan Academy 등 오래 유지되는 주소. 네트워크가 되면 `curl -sL -o /dev/null -w "%{http_code}" URL`로 200인지 확인합니다.
- **JSON 안의 TeX는 역슬래시를 두 번**: `"$\\frac{a}{b}$"`, `"$\\theta$"`. (한 번만 쓰면 `\f`, `\t`, `\n`, `\b`, `\r`이 제어 문자로 바뀌어 수식이 깨집니다 — 검사기가 잡아냅니다.)

## 품질 체크리스트

- [ ] 사실·숫자가 정확한가? 확실하지 않은 수치는 쓰지 않거나 "약"으로 반올림하고 널리 알려진 값만 씁니다. 인용문을 지어내지 않습니다.
- [ ] 모든 계산 문제의 정답을 Python으로 다시 계산했는가? 해설의 숫자와 `answer`가 일치하는가?
- [ ] 객관식 정답이 하나뿐이고, 오답 보기도 그럴듯한가?
- [ ] 본문이 커리큘럼의 `topics`를 모두 다루는가? 앞 강좌와 자연스럽게 이어지는가?
- [ ] "Day N에서 배운 …"처럼 다른 강좌를 가리킬 때, 그 내용이 정말 Day N에 있는지 `content/lessons/NNN.md`나 `curriculum.json`으로 확인했는가?
- [ ] 그림의 글자가 viewBox(가로 560) 밖으로 나가거나 선과 겹치지 않는가? (한글 13px 글자는 한 글자에 약 13px 폭)
- [ ] 영어 지문에 그날 단어가 4개 이상 들어갔는가? 번역이 정확한가?
- [ ] `python scripts/build.py --check` 통과.

## 커리큘럼 확장

`--todo`가 "커리큘럼의 모든 강좌가 작성되었습니다"라고 하면, `content/curriculum.json`의 `units` 끝에 새 단원을 하나 추가합니다(심화 주제: 예를 들어 압축성 유동, 연소, 유한요소법, 우주 임무 설계, 제어 이론 등 지금까지의 단원을 한 단계 깊게). 단원 `id`는 다음 번호(`U16`…), 7–12개 Day, Day 번호는 끊기지 않게 이어 붙입니다. 그 뒤 평소 절차대로 강좌를 씁니다.

## 사이트 코드 수정 시 (사용자와 함께 작업할 때)

- 빌드 도구 없이 동작해야 합니다. 외부 라이브러리는 CDN(jsdelivr)의 고정 버전만: marked 12.0.2, KaTeX 0.16.11, Pretendard 1.3.9.
- 정규식 lookbehind 등 구형 iOS Safari에서 문법 오류가 나는 기능은 쓰지 않습니다.
- 수정 후 `python scripts/build.py`와 로컬 서버로 홈·강좌·단어장·테스트 화면을 확인합니다. 라이트/다크, 폰 폭(390px)도 확인합니다.
- 학습자의 localStorage 키(`aerodaily.v1`) 구조를 바꿀 때는 기존 기록을 그대로 읽을 수 있게 호환성을 유지합니다.
