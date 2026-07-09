const TRUST_KEY = "50mmretina_trusted_devices";

const getDeviceId = (): string => {
  let id = localStorage.getItem("50mmretina_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("50mmretina_device_id", id);
  }
  return id;
};

export const useTrustedDevice = () => {
  const deviceId = getDeviceId();

  const isDeviceTrusted = (userId: string): boolean => {
    try {
      const raw = localStorage.getItem(TRUST_KEY);
      if (!raw) return false;
      const trusted: Record<string, string[]> = JSON.parse(raw);
      return trusted[userId]?.includes(deviceId) ?? false;
    } catch { return false; }
  };

  const trustDevice = (userId: string) => {
    try {
      const raw = localStorage.getItem(TRUST_KEY);
      const trusted: Record<string, string[]> = raw ? JSON.parse(raw) : {};
      if (!trusted[userId]) trusted[userId] = [];
      if (!trusted[userId].includes(deviceId)) trusted[userId].push(deviceId);
      localStorage.setItem(TRUST_KEY, JSON.stringify(trusted));
    } catch { /* ignore */ }
  };

  const removeTrust = (userId: string) => {
    try {
      const raw = localStorage.getItem(TRUST_KEY);
      if (!raw) return;
      const trusted: Record<string, string[]> = JSON.parse(raw);
      if (trusted[userId]) {
        trusted[userId] = trusted[userId].filter(d => d !== deviceId);
        localStorage.setItem(TRUST_KEY, JSON.stringify(trusted));
      }
    } catch { /* ignore */ }
  };

  return { deviceId, isDeviceTrusted, trustDevice, removeTrust };
};
