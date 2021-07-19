import { Header } from "@polkadot/types/interfaces";

export interface RawProof {
  height: number;
  header: string;
  encoded_message: string;
}

export interface Proof {
  height: number;
  header: Header;
  encoded_message: string;
}
