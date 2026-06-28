/* =========================================================================
   BRICK RUSH — push.js
   Subscribes the owner/admin to web-push so new applications buzz their phone.
   Stores the subscription in Supabase; the push-notify function sends it.
   ========================================================================= */
(function () {
  const CFG = window.BRICKRUSH_CONFIG;

  function urlB64ToUint8(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  const Push = {
    supported() {
      return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    },
    async isOn() {
      if (!this.supported()) return false;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return false;
        return Boolean(await reg.pushManager.getSubscription());
      } catch (e) { return false; }
    },
    async enable() {
      if (!this.supported()) return { error: 'This device/browser can’t do push notifications.' };
      if (!CFG.vapidPublicKey) return { error: 'Push isn’t configured (no key).' };
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return { error: 'Notifications are blocked — allow them in your browser/phone settings.' };
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(CFG.vapidPublicKey),
        });
      }
      const user = window.Auth && window.Auth.getUser && window.Auth.getUser();
      if (window.SB && user) {
        const { error } = await window.SB.from('push_subscriptions').upsert(
          { discord_id: user.id, endpoint: sub.endpoint, subscription: sub.toJSON() },
          { onConflict: 'endpoint' }
        );
        if (error) return { error: error.message };
      }
      return { ok: true };
    },
    async disable() {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && (await reg.pushManager.getSubscription());
        if (sub) {
          if (window.SB) await window.SB.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          await sub.unsubscribe();
        }
      } catch (e) {}
      return { ok: true };
    },
  };

  window.BrickPush = Push;
})();
