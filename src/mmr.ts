import { Hash } from "@polkadot/types/interfaces";
const { soliditySha3 } = require("web3-utils");

interface MountainData {
  position: number;
  hash: string;
  height: number;
}

function numOfPeaks(numLeaves: number): number {
  let bits: number = numLeaves;
  let numPeaks: number = 0;
  while (bits > 0) {
    if (bits % 2 == 1) numPeaks++;
    bits = bits >> 1;
  }
  return numPeaks;
}

function leafIndexToPos(index: number): number {
  return leafIndexToMmrSize(index) - trailingZeros(index + 1);
}

function bitCount(n: number): number {
  let count = 0;
  while (n > 0) {
    count = count + 1;
    n = n & (n - 1);
  }
  return count;
}

function leafIndexToMmrSize(index: number): number {
  const leavesCount = index + 1;
  const peaksCount = bitCount(leavesCount);
  return 2 * leavesCount - peaksCount;
}

function trailingZeros(x: number): number {
  if (x == 0) return 32;
  let n = 1;
  if ((x & 0x0000ffff) == 0) {
    n = n + 16;
    x = x >> 16;
  }
  if ((x & 0x000000ff) == 0) {
    n = n + 8;
    x = x >> 8;
  }
  if ((x & 0x0000000f) == 0) {
    n = n + 4;
    x = x >> 4;
  }
  if ((x & 0x00000003) == 0) {
    n = n + 2;
    x = x >> 2;
  }
  return n - (x & 1);
}

function getPeakPositions(width: number): number[] {
  const peakPositions: number[] = new Array(numOfPeaks(width));
  let count: number = 0;
  let size: number = 0;
  for (let i = 255; i > 0; i--) {
    if (width && 1 << (i - 1) != 0) {
      size = size + (1 << i) - 1;
      peakPositions[count++] = size;
    }
  }
  if (count != peakPositions.length) {
    throw Error("Invalid bit calculation");
  }
  return peakPositions;
}

const queue: MountainData[] = [];
function calculatePeakRoot(
  numLeftPeaks: number,
  leafNodeHash: any,
  leafPos: number,
  peakPos: number,
  proofItems: any
): string | undefined {
  if (leafPos == peakPos) {
    return leafNodeHash;
  }
  let proofItemsCounter = numLeftPeaks;
  let qFront: number = 0;
  let qBack: number = 0;

  const mountainData: MountainData = {
    position: leafPos,
    hash: leafNodeHash,
    height: 1,
  };

  queue[qBack] = mountainData;
  qBack = qBack + 1;

  while (qBack >= qFront) {
    let mData = queue[qFront];
    let pos: number = mData.position;

    let siblingPos: number;
    let parentPos: number;

    let nextHeight: number = heightAt(pos + 1);
    let sibOffset: number = siblingOffset(mData.height - 1);
    if (nextHeight > mData.height) {
      siblingPos = pos - sibOffset;
      parentPos = pos + 1;
    } else {
      siblingPos = pos + sibOffset;
      parentPos = pos + parentOffset(mData.height - 1);
    }

    let siblingHash;
    if (siblingPos == queue[qFront].position) {
      siblingHash = queue[qFront].hash;
    } else {
      siblingHash = proofItems[proofItemsCounter];
      proofItemsCounter = proofItemsCounter + 1;
    }

    // Calculate parent hash
    let parentHash;
    if (nextHeight > mData.height) {
      parentHash = soliditySha3(siblingHash, mData.hash);
    } else {
      parentHash = soliditySha3(mData.hash, siblingHash);
    }

    if (parentPos < peakPos) {
      // Parent is not the mountain peak
      queue[qBack] = {
        position: parentPos,
        hash: parentHash,
        height: mData.height + 1,
      };
      qBack = qBack + 1;
    } else {
      // Parent is the peak
      delete queue[qFront];
      return parentHash;
    }

    // Move to next item in queue
    delete queue[qFront];
    qFront = qFront + 1;
  }
}

function mountainHeight(size: number): number {
  let height = 1;
  while (1 << height <= size + height) {
    height++;
  }
  return height - 1;
}

function heightAt(index: number): number {
  let reducedIndex = index;
  let peakIndex = 0;
  let height = 0;
  // If an index has a left mountain subtract the mountain
  while (reducedIndex > peakIndex) {
    reducedIndex -= (1 << height) - 1;
    height = mountainHeight(reducedIndex);
    peakIndex = (1 << height) - 1;
  }
  // Index is on the right slope
  return height - (peakIndex - reducedIndex);
}

function siblingOffset(height: number): number {
  return (2 << height) - 1;
}

function parentOffset(height: number): number {
  return 2 << height;
}

function verifyInclusionProof(
  root: string,
  leafNodeHash: string,
  leafIndex: number,
  leafCount: number,
  proofItems: string[]
) {
  const leafPos = leafIndexToPos(leafIndex);
  const peakPositions = getPeakPositions(leafCount);

  let targetPeakPos = 0;
  let numLeftPeaks = 0;
  for (let index = 0; index < peakPositions.length; index++) {
    if (peakPositions[index] >= leafPos) {
      targetPeakPos = peakPositions[index];
      break;
    }
    numLeftPeaks++;
  }

  const mountainHash = calculatePeakRoot(
    numLeftPeaks,
    leafNodeHash,
    leafPos,
    targetPeakPos,
    proofItems
  );

  let bagger = mountainHash;

  // All right peaks are rolled up into one hash. If there are any, bag them.
  if (targetPeakPos < peakPositions[peakPositions.length - 1]) {
    bagger = soliditySha3(proofItems[proofItems.length - 1], bagger);
  }

  // Bag left peaks one-by-one
  for (let i = numLeftPeaks; i > 0; i--) {
    bagger = soliditySha3(bagger, proofItems[i - 1]);
  }

  return bagger == root;
}
