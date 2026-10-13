// push-access.js — WHO may see the notification test features. TEMPORARY: during the test phase only the coordinator sees them.
//
// TO REMOVE THE RESTRICTION (after testing), see README "Meldingen (testfase)": set COORDINATOR_ONLY to false below. That is the only
// line in the app that decides who sees the screens. Every screen and every function of the push features asks pushVisible() here.
// Note: this only changes what is SHOWN. Who may store a device, and who gets a push, is decided on the server (firestore.rules and
// settings/push.mode); there is deliberately no "live" mode yet, so nothing is sent to other families whatever this flag says.
import { S } from './state.js';
import { isMemberFor, isRealCoordinatorFor } from './coordinator.js';

export const COORDINATOR_ONLY = true;

export function pushVisibleFor(state){
  return COORDINATOR_ONLY ? isRealCoordinatorFor(state) : isMemberFor(state);
}
export function pushVisible(){ return pushVisibleFor(S); }
