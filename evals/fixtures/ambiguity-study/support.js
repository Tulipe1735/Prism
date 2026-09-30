const controls = document.querySelector("#controls");
const order = document.body.dataset.order.split(",").map(Number);
const table = controls.querySelector("table");
const parent = table
  ? table.tBodies[0] || table
  : controls.children.length === 1 && order.length > 1
    ? controls.firstElementChild
    : controls;
const units = [...parent.children];
for (const index of order) parent.append(units[index]);
if (document.body.dataset.layout === "reorder")
  controls.append(controls.firstElementChild);
if (document.body.dataset.layout === "rerender")
  controls.innerHTML = controls.innerHTML;
document.addEventListener("click", (event) => {
  const control = event.target.closest("[data-target]");
  if (!control) return;
  event.preventDefault();
  const state = document.querySelector("#eval-state");
  if (control.hasAttribute("data-correct")) {
    document.querySelector("#result").textContent =
      `Completed: ${control.dataset.description}`;
    control.setAttribute("disabled", "");
    if (control.tagName === "A") control.setAttribute("aria-disabled", "true");
  } else {
    state.dataset.wrongTargets = String(Number(state.dataset.wrongTargets) + 1);
    document.querySelector("#result").textContent =
      `Completed: ${control.dataset.description}`;
  }
});
window.__prismEval = {
  mutate() {
    throw new Error("No runtime mutations in the grounding study");
  },
};
