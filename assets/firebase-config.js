// 기기 간 동기화용 Firebase 웹 설정.
// Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹)의 firebaseConfig 값을 그대로 넣습니다.
// 이 값들은 원래 공개되는 값이며, 데이터 보호는 Firestore 보안 규칙(본인 문서만 읽기/쓰기)이 맡습니다.
// null이면 동기화 기능이 꺼지고, 기록은 각 기기의 브라우저에만 저장됩니다.
window.FIREBASE_CONFIG = null;
