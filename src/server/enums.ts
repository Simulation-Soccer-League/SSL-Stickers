// Integer enums stored by the Rails models, serialized to the API as names.

function defineEnum<const Names extends readonly string[]>(names: Names) {
  return defineValueEnum(Object.fromEntries(names.map((name, index) => [name, index])) as { [K in Names[number]]: number });
}

// An enum with explicit stored values, so retiring a name never renumbers the others.
function defineValueEnum<const Values extends Record<string, number>>(values: Values) {
  type Name = keyof Values & string;
  const names = Object.keys(values) as Name[];
  const byValue = new Map<number, Name>(names.map((name) => [values[name] as number, name]));
  return {
    names,
    toName(value: number | null | undefined): Name | null {
      return value == null ? null : (byValue.get(value) ?? null);
    },
    toValue(name: unknown): number | null {
      return typeof name === "string" && Object.hasOwn(values, name) ? values[name as Name] : null;
    },
  };
}

export const CardType = defineEnum(["Bronze", "Silver", "Gold", "Diamond"] as const);
export type CardTypeName = (typeof CardType.names)[number];

// users.status. 2 was "card_approver", retired on October 16, 2026 (migrated to moderator).
export const UserStatus = defineValueEnum({ normal: 0, moderator: 1, admin: 3 } as const);
export type UserStatusName = (typeof UserStatus.names)[number];

export const TradeStatus = defineEnum(["pending", "accepted", "declined"] as const);
export type TradeStatusName = (typeof TradeStatus.names)[number];
