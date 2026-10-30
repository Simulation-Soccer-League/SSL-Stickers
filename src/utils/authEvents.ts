export const loginRequestedEvent = "ssl-login-requested";

export function requestLogin() {
  window.dispatchEvent(new Event(loginRequestedEvent));
}
