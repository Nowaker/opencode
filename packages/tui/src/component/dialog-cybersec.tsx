import { onMount } from "solid-js"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { createCybersecPreservation, cybersecTransport, saveCybersec, type CybersecPreference } from "./cybersec-preservation"

// Picks which accounts carry this session's Claude quota. It is quota routing, not a security setting.
export function DialogCybersec(props: { current?: CybersecPreference; onChoose: (preference: CybersecPreference) => void }) {
  const dialog = useDialog()
  onMount(() => dialog.setSize("large"))
  return (
    <DialogSelect<CybersecPreference>
      title="Cybersec preservation for this session"
      current={props.current}
      onSelect={(option) => props.onChoose(option.value)}
      options={[
        { value: "inherit", title: "Follow this machine's default", description: "set with /cybersec-preservation" },
        { value: "on", title: "On", description: "keep this session's Claude quota off the CVP accounts" },
        { value: "off", title: "Off", description: "let this session use the CVP accounts like any other" },
      ]}
    />
  )
}

// `/cybersec` from the palette: reads the session's preference, then saves the choice and closes.
export function DialogCybersecSession(props: { sessionID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const cybersec = createCybersecPreservation({
    sessionID: () => props.sessionID,
    request: cybersecTransport(sdk),
    onFailure: (message) => toast.show({ message, variant: "error" }),
  })
  return (
    <DialogCybersec
      current={cybersec.status?.preference}
      onChoose={(preference) => {
        const refusal = cybersec.refusal()
        if (refusal) return toast.show({ message: refusal, variant: "info", duration: 3000 })
        dialog.clear()
        void saveCybersec(sdk, props.sessionID, preference).then((message) => toast.show(message))
      }}
    />
  )
}
