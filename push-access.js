// push-access.js — WHO may see the push TEST features ("Push-meldingen testen"): only the coordinator. This is a lasting choice (owner, 2026-11-14):
// the test card stays, as the coordinator's own tool to try notifications.
// (The parents' own switch in Instellingen is not decided here: it follows the push switch on the Ritten-ruilen card, see ui-push-device.js.)
//
// COORDINATOR_ONLY below is the only line in the app that decides who sees the screens (README "Push-meldingen (test en live)"). Every screen and every function of the push features asks pushVisible() here.
// Note: this only changes what is SHOWN. Who may store a device, and who gets a push, is decided on the server (firestore.rules and
// settings/push); nothing is sent to other families unless the push switch on the Ritten-ruilen card is on, whatever this flag says.
import { S } from './state.js';
import { isMemberFor, isRealCoordinatorFor } from './coordinator.js';

export const COORDINATOR_ONLY = true;

export function pushVisibleFor(state){
  return COORDINATOR_ONLY ? isRealCoordinatorFor(state) : isMemberFor(state);
}
export function pushVisible(){ return pushVisibleFor(S); }
