import { getComponentCatalogue } from "@opentui/solid/components"
import { extend } from "@opentui/solid"
import { CliRenderer, type RenderContext } from "@opentui/core"
import { SpinnerRenderable, type SpinnerOptions } from "opentui-spinner"
import type {} from "opentui-spinner/solid"

class OpencodeSpinner extends SpinnerRenderable {
  private requestedInterval: number
  private readonly renderer: CliRenderer | undefined

  constructor(ctx: RenderContext, options: SpinnerOptions) {
    super(ctx, options)
    this.requestedInterval = super.interval
    this.renderer = ctx instanceof CliRenderer ? ctx : undefined
    this.renderer?.on("focus", this.updateInterval)
    this.renderer?.on("blur", this.updateInterval)
    this.updateInterval()
  }

  override get interval() {
    return this.requestedInterval
  }

  override set interval(value: number) {
    this.requestedInterval = value
    this.updateInterval()
  }

  private updateInterval = () => {
    super.interval = this.renderer?.terminalFocused === false ? 1000 : this.requestedInterval
  }

  protected override destroySelf() {
    this.renderer?.off("focus", this.updateInterval)
    this.renderer?.off("blur", this.updateInterval)
    super.destroySelf()
  }
}

export function registerOpencodeSpinner() {
  if (!getComponentCatalogue().spinner) extend({ spinner: OpencodeSpinner })
}
