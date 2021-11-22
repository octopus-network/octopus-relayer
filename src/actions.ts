import { Account } from "near-api-js";
import { tryComplete } from "./nearCalls";
import { getNextHeight, getLatestFinalizedHeight } from "./blockHeights";
import types from "./types";
import { dbRunAsync, dbAllAsync, upsertActions } from "./db";
import { Action, ActionType } from "./interfaces";

export async function storeAction(type: ActionType): Promise<any> {
  return await upsertActions({
    type,
    status: 0,
  });
}

async function actionCompleted(type: ActionType) {
  await dbRunAsync(`UPDATE actions SET status = ? WHERE type == ?`, [1, type]);
}

async function getNotCompletedActions(height: number): Promise<Action[]> {
  const actions: Action[] = await dbAllAsync(
    "SELECT * FROM actions WHERE status == 0"
  );
  return actions;
}

export async function tryCompleteActions(account: Account) {
  const nextHeight = await getNextHeight();
  const currentHeight = nextHeight - 1;
  const actions: Action[] = await getNotCompletedActions(currentHeight);
  for (let index = 0; index < actions.length; index++) {
    try {
      const { type } = actions[index];
      if (type === "PlanNewEra") {
        const switchingEraResult = await tryComplete(
          "try_complete_switching_era"
        );
        if (switchingEraResult === "Ok") {
          await actionCompleted(type);
        }
      }
      if (type === "EraPayout") {
        const distributingRewardtResult = await tryComplete(
          "try_complete_distributing_reward"
        );
        if (distributingRewardtResult === "Ok") {
          await actionCompleted(type);
        }
      }
      if (type === "UpdateState") {
        const updatetStateResult = await tryComplete(
          "try_complete_updating_state_of_beefy_light_client"
        );
        if (updatetStateResult === "Ok") {
          await actionCompleted(type);
        }
      }
    } catch (e) {
      console.error("tryCompleteActions failed", e);
    }
  }
  setTimeout(() => {
    tryCompleteActions(account);
  }, 200);
}

export async function confirmAction(
  payloadTypeString: ActionType
): Promise<boolean | undefined> {
  console.log("confirmAction", payloadTypeString);
  if (payloadTypeString == "PlanNewEra") {
    const switchingEraResult = await tryComplete("try_complete_switching_era");
    if (switchingEraResult != "Ok") {
      return await confirmAction(payloadTypeString);
    } else {
      return true;
    }
  }
  if (payloadTypeString == "EraPayout") {
    const distributingRewardtResult = await tryComplete(
      "try_complete_distributing_reward"
    );
    if (distributingRewardtResult != "Ok") {
      return await confirmAction(payloadTypeString);
    } else {
      return true;
    }
  }
  if (payloadTypeString === "UpdateState") {
    const updatetStateResult = await tryComplete(
      "try_complete_updating_state_of_beefy_light_client"
    );
    if (updatetStateResult != "Ok") {
      return await confirmAction(payloadTypeString);
    } else {
      return true;
    }
  }
}
