// All changes are explicit and acknowledged; there are no random timers or network calls.
const state = document.querySelector("#eval-state");
const notice = document.querySelector("#notice");
document.addEventListener("click", (event) => {
  const control = event.target.closest("[data-target]");
  if (!control) return;
  if (control.hasAttribute("data-correct")) {
    document.querySelector("#result").textContent = document.body.dataset.success;
    control.disabled = true;
  } else {
    state.dataset.wrongTargets = String(Number(state.dataset.wrongTargets) + 1);
    document.querySelector("#result").textContent =
      `Wrong target: ${control.dataset.target}`;
  }
});
document.querySelector("#dismiss").addEventListener("click", () => notice.close());
window.__prismEval = {
  mutate() {
    if (state.dataset.mutations !== "0") throw new Error("Mutation already applied");
    state.dataset.mutations = "1";
    const controls = document.querySelector("#controls");
    const correct = controls.querySelector("[data-correct]");
    switch (document.body.dataset.scenario) {
      case "rerender":
        controls.innerHTML = controls.innerHTML;
        break;
      case "node-replacement":
        correct.replaceWith(correct.cloneNode(true));
        break;
      case "reordering":
        controls.prepend(correct);
        break;
      case "delayed-modal":
        notice.showModal();
        break;
      case "disappearing": {
        const replacement = correct.cloneNode(true);
        correct.remove();
        controls.append(replacement);
        break;
      }
      case "state-change":
        correct.value = "revised";
        document.querySelector("#revision").textContent =
          "The draft is now revision 2.";
        break;
      default:
        throw new Error("This fixture has no mutation");
    }
    return { mutations: Number(state.dataset.mutations) };
  },
};
