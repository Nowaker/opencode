import type { SessionApi } from "@opencode/client/promise/api"
import type { Form } from "@opencode/schema/form"

export interface FormDomain extends Pick<SessionApi["form"], "get" | "reply" | "cancel"> {
  readonly list: (
    input?: Partial<Parameters<SessionApi["form"]["list"]>[0]>,
  ) => Promise<ReadonlyArray<typeof Form.Info.Encoded>>
}
