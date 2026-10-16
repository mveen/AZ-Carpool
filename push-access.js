// push-access.js — WHO may see the push TEST features ("Push-meldingen testen"). TEMPORARY: during the test phase only the coordinator sees them.
// (The parents' own switch in Instellingen is not decided here: it follows the push switch on the Ritten-ruilen card, see ui-push-device.js.)
//
// TO REMOVE THE RESTRICTION (after testing), see README "Push-meldingen (test en live)": set COORDINATOR_ONLY to false below. That is the only
// line in the app that decides who sees the screens. Every screen and every function of the push features asks pushVisible() here.
// Note: this only changes what is SHOWN. Who may store a device, and who gets a push, is decided on the server (firestore.rules and
// settings/push); nothing is sent to other families unless the push switch on the Ritten-ruilen card is on, whatever this flag says.
import { S } from './state.js';
import { isMemberFor, isRealCoordinatorFor } from './coordinator.js';

export const COORDINATOR_ONLY = true;

export function pushVisibleFor(state){
  return COORDINATOR_ONLY ? isRealCoordinatorFor(state) : isMemberFor(state);
}
export function pushVisible(){ return pushVisibleFor(S); }
