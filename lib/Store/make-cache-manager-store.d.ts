import { AuthenticationState } from '../Types';
declare const makeCacheManagerAuthState: (store: unknown, sessionKey: string) => Promise<{
    clearState: () => Promise<void>;
    saveCreds: () => Promise<void>;
    state: AuthenticationState;
}>;
export default makeCacheManagerAuthState;
