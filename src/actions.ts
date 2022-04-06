import { Account } from "near-api-js";
import { ApiPromise } from "@polkadot/api";
import { tryComplete, getAnchorSettings, checkAnchorIsWitnessMode } from "./nearCalls";
import { getNextHeight, getLatestFinalizedHeight } from "./blockHeights";
import { dbRunAsync, dbAllAsync, upsertActions, dbGetAsync } from "./db";
import { Action, ActionType } from "./interfaces";
import { Type } from "@polkadot/types";
import { updateStateMinInterval } from "./constants";

export async function storeAction(type: ActionType): Promise<any> {
  await upsertActions({
    type,
    status: 0,
  });
  const actions = await getActions();
  console.log("actions", actions);
}

async function actionCompleted(type: ActionType) {
  console.log("actionCompleted", type);
  await dbRunAsync(`UPDATE actions SET status = ? WHERE type == ?`, [1, type]);
  await unmarkFailedAction(type);
  const actions = await getActions();
  console.log("actions", actions);
}

async function getActions(): Promise<Action[]> {
  const actions: Action[] = await dbAllAsync("SELECT * FROM actions");
  return actions;
}

async function getAction(type: ActionType): Promise<Action> {
  const action: Action = await dbGetAsync(
    `SELECT * FROM actions WHERE type == ?`,
    [type]
  );
  return action;
}

async function getNotCompletedActions(): Promise<Action[]> {
  const actions: Action[] = await dbAllAsync(
    "SELECT * FROM actions WHERE status == 0"
  );
  return actions;
}

let tryCompleteActionsTimer: any = null;
export async function tryCompleteActions(
  account: Account,
  appchain: ApiPromise
) {
  clearTimeout(tryCompleteActionsTimer);
  if (appchain.isConnected) {
    const actions: Action[] = await getNotCompletedActions();
    for (let index = 0; index < actions.length; index++) {
      const { type } = actions[index];
      try {
        const healthy = await isActionHealthy(type);
        if (healthy) {
          if (type === "UpdateState") {
            const isWitnessMode = await checkAnchorIsWitnessMode();
            if (!isWitnessMode) {
              const updatetStateResult = await tryComplete(
                "try_complete_updating_state_of_beefy_light_client"
              );
              if (updatetStateResult) {
                await actionCompleted(type);
              }
            }
          }
        }
      } catch (e: any) {
        console.error("tryCompleteActions failed", e);
        if (e.transaction_outcome) {
          await markFailedAction(type);
          console.error(
            "tryCompleteActions failed-txId",
            e.transaction_outcome.id
          );
        }
      }
    }
    tryCompleteActionsTimer = setTimeout(() => {
      tryCompleteActions(account, appchain);
    }, 200);
  }
}

async function markFailedAction(payloadTypeString: ActionType) {
  await upsertActions({
    type: payloadTypeString,
    status: 0,
    failed_at: Date.now()
  });
  console.error("tryCompleteActions stopped", payloadTypeString);
}

async function unmarkFailedAction(payloadTypeString: ActionType) {
  await dbRunAsync(`UPDATE actions SET failed_at = NULL WHERE type == ?`, [
    payloadTypeString,
  ]);
  console.log("tryCompleteActions continue", payloadTypeString);
}

export async function confirmAction(
  payloadTypeString: ActionType
): Promise<boolean> {
  console.log("confirmAction", payloadTypeString);
  let returnVal = false;
  try {
    const healthy = await isActionHealthy(payloadTypeString);
    if (healthy) {
      if (payloadTypeString === "UpdateState") {
        const updatetStateResult = await tryComplete(
          "try_complete_updating_state_of_beefy_light_client"
        );
        if (!updatetStateResult) {
          returnVal = await confirmAction(payloadTypeString);
        } else {
          returnVal = true;
        }
      }
      await unmarkFailedAction(payloadTypeString);
    }
  } catch (e: any) {
    console.error("tryCompleteActions failed", e);
    if (e.transaction_outcome) {
      await markFailedAction(payloadTypeString);
      console.error(
        "tryCompleteActions failed-txId",
        e.transaction_outcome.id
      );
    }
  }
  return returnVal;
}

export async function isActionCompleted(type: ActionType) {
  const action = await getAction(type);
  return action ? action.status === 1 : true;
}

export async function isActionHealthy(type: ActionType) {
  const action = await getAction(type);
  if (!action || !action.failed_at || Date.now() - action.failed_at > updateStateMinInterval * 60 * 1000) {
    return true;
  } else {
    return false;
  }
}
