import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "fixture.composer-observation",
  setup(context) {
    context.ui.router.register({ name: "observation", render: () => <text>Observation page</text> })
    context.ui.composer?.subscribe((value) => context.renderer.emit("fixture.composer-change", value))
    context.renderer.emit("fixture.composer-observation", context)
  },
})
