import { CardShadowPage } from "./routes/card-shadow";
import { FormEnablementPage } from "./routes/form-enablement";
import { MobileOverflowPage } from "./routes/mobile-overflow";
import { ProfileDialogPage } from "./routes/profile-dialog";
import { RoundButtonPage } from "./routes/round-button";

/**
 * 极简路由：按 location.pathname 分发到各场景页面。
 *
 * 场景路由：
 *  - /round-button —— “让主 Save 按钮变圆”（已知缺陷：按钮是方形）
 *  - /card-shadow —— “恢复 profile card 阴影”（已知缺陷：阴影缺失）
 *  - /profile-dialog —— “修复 Edit profile Dialog”（已知缺陷：按钮无响应）
 *  - /form-enablement —— “修复有效邮箱仍无法提交”（已知缺陷：Submit 始终禁用）
 *  - /mobile-overflow —— “修复移动端结账操作溢出”（已知缺陷：操作区宽于视口）
 */
export function App() {
  const pathname = window.location.pathname;

  if (pathname === "/round-button") {
    return <RoundButtonPage />;
  }

  if (pathname === "/card-shadow") {
    return <CardShadowPage />;
  }

  if (pathname === "/profile-dialog") {
    return <ProfileDialogPage />;
  }

  if (pathname === "/form-enablement") {
    return <FormEnablementPage />;
  }

  if (pathname === "/mobile-overflow") {
    return <MobileOverflowPage />;
  }

  return (
    <main className="page">
      <h1>react-repair fixture</h1>
      <ul>
        <li>
          <a href="/round-button">Round the primary Save button</a>
        </li>
        <li>
          <a href="/card-shadow">Restore the profile card shadow</a>
        </li>
        <li>
          <a href="/profile-dialog">Repair the profile Dialog</a>
        </li>
        <li>
          <a href="/form-enablement">Repair form enablement</a>
        </li>
        <li>
          <a href="/mobile-overflow">Repair mobile checkout overflow</a>
        </li>
      </ul>
    </main>
  );
}
