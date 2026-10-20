// 기기 간 동기화용 Firebase 웹 설정 (Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹)의 firebaseConfig).
// 이 값들은 원래 공개되는 값이며, 데이터 보호는 Firestore 보안 규칙(firestore.rules: 본인 문서만 읽기/쓰기)이 맡습니다.
// null로 바꾸면 동기화 기능이 꺼지고, 기록은 각 기기의 브라우저에만 저장됩니다.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCEfg45EvKLXBDzKZOU2bFRh6JmL2lZTGs",
  authDomain: "aerospace-daily.firebaseapp.com",
  projectId: "aerospace-daily",
  storageBucket: "aerospace-daily.firebasestorage.app",
  messagingSenderId: "625363765205",
  appId: "1:625363765205:web:74ffc65168271401d75f5c",
  databaseId: "default", // Firestore 데이터베이스 ID (콘솔에서 '(default)'가 아닌 'default'라는 이름으로 만들어짐)
};
