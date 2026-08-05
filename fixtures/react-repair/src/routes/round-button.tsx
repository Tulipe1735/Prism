/**
 * 场景 1 —— 圆形主按钮（Round the primary Save button）。
 *
 * 已知缺陷（known-bad）：主 Save 按钮是方形 —— border-radius: 0。
 * 修复方向：让按钮明显变圆，同时保持标签、可点击性与控件尺寸不变。
 *
 * 固定本地数据：姓名列表写死在组件里，不发任何网络请求；按钮带显式
 * aria 可访问名 “Save”，供语义目标定位。
 */
const SAVED_USERS = ["Ada Lovelace", "Grace Hopper"] as const;

export function RoundButtonPage() {
  return (
    <main className="page">
      <h1>Profile settings</h1>
      <section className="panel">
        <form className="profile-form" aria-label="Profile settings">
          <label className="field">
            <span className="field-label">Display name</span>
            <input
              className="text-input"
              type="text"
              name="displayName"
              defaultValue="Ada Lovelace"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              className="text-input"
              type="email"
              name="email"
              defaultValue="ada@example.test"
              autoComplete="off"
            />
          </label>
          <p className="hint">
            Saved as {SAVED_USERS.join(", ")} — data is local to this fixture.
          </p>
          <button className="save-button" type="submit" aria-label="Save">
            Save
          </button>
        </form>
      </section>
    </main>
  );
}
