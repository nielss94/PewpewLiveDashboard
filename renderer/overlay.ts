(() => {
  const { createApp, ref, onMounted } = (window as any).Vue;
  createApp({
    setup() {
      type Toast = {
        id: string;
        title: string;
        body?: string;
        icon?: string;
        severity: "info" | "warning" | "critical";
        until: number;
      };
      const toasts = ref([] as Array<Toast>);
      onMounted(() => {
        if ((window as any).api?.onTip) {
          (window as any).api.onTip((tip: any) => {
            const stickyMs =
              typeof tip?.stickyMs === "number" && tip.stickyMs > 0
                ? tip.stickyMs
                : 4000;
            const until = Date.now() + stickyMs;
            const severity =
              tip?.severity === "warning" || tip?.severity === "critical"
                ? tip.severity
                : "info";
            let toastTitle = String(tip?.title || "").trim();
            const toastBodyRaw = tip?.body ? String(tip.body) : "";
            const toastBody = toastBodyRaw ? toastBodyRaw.trim() : "";
            if (!toastTitle && toastBody) {
              toastTitle =
                toastBody.length > 80 ? toastBody.slice(0, 80) + "…" : toastBody;
            }
            if (!toastTitle) toastTitle = "Notification";
            toasts.value.push({
              id: String(tip?.id || Math.random()),
              title: toastTitle,
              body: toastBody || undefined,
              icon: tip?.icon ? String(tip.icon) : undefined,
              severity,
              until,
            });
          });
        }
      });
      setInterval(() => {
        const now = Date.now();
        toasts.value = toasts.value.filter((t: Toast) => t.until > now);
      }, 1000);
      return { toasts };
    },
  }).mount("#app");
})();


