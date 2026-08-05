import { RoundButtonPage } from "./routes/round-button";

/**
 * 极简路由：按 location.pathname 分发到各场景页面。
 *
 * 场景路由：
 *  - /round-button —— “让主 Save 按钮变圆”（已知缺陷：按钮是方形）
 */
export function App() {
  const pathname = window.location.pathname;

  if (pathname === "/round-button") {
    return <RoundButtonPage />;
  }

  return (
    <main className="page">
      <h1>react-repair fixture</h1>
      <ul>
        <li>
          <a href="/round-button">Round the primary Save button</a>
        </li>
      </ul>
    </main>
  );
}
