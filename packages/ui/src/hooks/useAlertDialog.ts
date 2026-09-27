import { useAlertDialogStore, type AlertDialogRequest } from "@/store/alertDialogStore.js";

export function useAlertDialog(): (payload: AlertDialogRequest) => Promise<boolean> {
  return useAlertDialogStore((state) => state.requestAlert);
}
