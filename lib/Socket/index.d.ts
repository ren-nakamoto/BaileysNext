import { UserFacingSocketConfig } from '../Types';
import { patchModernSocket } from './modern-features';
declare const makeWASocket: (config: UserFacingSocketConfig) => ReturnType<typeof patchModernSocket>;
export default makeWASocket;
