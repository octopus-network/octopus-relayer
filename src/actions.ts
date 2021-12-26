import { Account } from "near-api-js";
import { ApiPromise } from "@polkadot/api";
import { tryComplete, getAnchorSettings } from "./nearCalls";
import { getNextHeight, getLatestFinalizedHeight } from "./blockHeights";
import { dbRunAsync, dbAllAsync, upsertActions, dbGetAsync } from "./db";
import { Action, ActionType } from "./interfaces";
import { Type } from "@polkadot/types";

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

export async function tryCompleteActions(
  account: Account,
  appchain: ApiPromise
) {
  if (appchain.isConnected) {
    const actions: Action[] = await getNotCompletedActions();
    for (let index = 0; index < actions.length; index++) {
      try {
        const { type } = actions[index];
        if (type === "PlanNewEra") {
          const switchingEraResult = await tryComplete(
            "try_complete_switching_era"
          );
          if (switchingEraResult) {
            await actionCompleted(type);
          }
        }
        if (type === "EraPayout") {
          const distributingRewardtResult = await tryComplete(
            "try_complete_distributing_reward"
          );
          if (distributingRewardtResult) {
            await actionCompleted(type);
          }
        }
        if (type === "UpdateState") {
          const updatetStateResult = await tryComplete(
            "try_complete_updating_state_of_beefy_light_client"
          );
          if (updatetStateResult) {
            await actionCompleted(type);
          }
        }
      } catch (e) {
        console.error("tryCompleteActions failed", e);
      }
    }
    setTimeout(() => {
      tryCompleteActions(account, appchain);
    }, 200);
  }
}

export async function confirmAction(
  payloadTypeString: ActionType
): Promise<boolean | undefined> {
  console.log("confirmAction", payloadTypeString);
  if (payloadTypeString == "PlanNewEra") {
    const switchingEraResult = await tryComplete("try_complete_switching_era");
    if (!switchingEraResult) {
      return await confirmAction(payloadTypeString);
    } else {
      return true;
    }
  }
  if (payloadTypeString == "EraPayout") {
    const distributingRewardtResult = await tryComplete(
      "try_complete_distributing_reward"
    );
    if (!distributingRewardtResult) {
      return await confirmAction(payloadTypeString);
    } else {
      return true;
    }
  }
  if (payloadTypeString === "UpdateState") {
    const updatetStateResult = await tryComplete(
      "try_complete_updating_state_of_beefy_light_client"
    );
    if (!updatetStateResult) {
      return await confirmAction(payloadTypeString);
    } else {
      return true;
    }
  }
}

export async function checkAnchorIsWitnessMode() {
  try {
    const anchorSettings = await getAnchorSettings();
    return anchorSettings
      ? anchorSettings.beefy_light_client_witness_mode
      : false;
  } catch (error) {
    console.error("checkAnchorIsWitnessMode error", error);
    return false;
  }
}

export async function isActionCompleted(type: ActionType) {
  const action = await getAction(type);
  return action ? action.status === 1 : true;
}
