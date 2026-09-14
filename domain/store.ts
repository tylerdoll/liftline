export type Item = { PK: string; SK: string; [key: string]: any };
export type Condition = {
  expression: string;
  names?: Record<string, string>;
  values?: Record<string, any>;
};
export type Write =
  | { put: Item; condition?: Condition }
  | { check: { PK: string; SK: string }; condition: Condition }
  | {
      update: { PK: string; SK: string };
      expression: string;
      names?: Record<string, string>;
      values: Record<string, any>;
    };
export interface Store {
  get(PK: string, SK: string): Promise<Item | undefined>;
  query(
    PK: string,
    prefix: string,
    cursor?: string,
    limit?: number,
    descending?: boolean,
  ): Promise<{ items: Item[]; cursor?: string }>;
  expired(
    now: number,
    cursor?: string,
  ): Promise<{ items: Item[]; cursor?: string }>;
  transact(writes: Write[]): Promise<void>;
}
export class Failure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const absent: Condition = { expression: "attribute_not_exists(PK)" };
export const atRevision = (revision: number): Condition =>
  revision === 0
    ? absent
    : {
        expression: "#r = :r",
        names: { "#r": "revision" },
        values: { ":r": revision },
      };
