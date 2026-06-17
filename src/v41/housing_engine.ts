// v4.1 — rent vs buy-and-settle.
//
// A "buy" strategy converts liquid capital into an illiquid home at buy_age and
// thereafter replaces rent with ownership cost (property tax + maintenance).
// The trade-off the model surfaces: buying lowers ongoing drawdown and gives a
// net-worth floor (you own a home), but the lump purchase shrinks the liquid
// portfolio that survival depends on.
import { strategiesConfig, systemConfig } from "../config";
import type { ProcessedCity, StrategyConfig } from "../types";

export interface HousingPlan {
  property_price: number;
  oneTimeOutflows: Map<number, number>;
  illiquidByAge: Map<number, number>;
  /** Replace post-purchase living cost (rent removed, ownership added). */
  modifyCost: (costByAge: Map<number, number>) => Map<number, number>;
}

const NO_HOUSING: Omit<HousingPlan, "modifyCost"> = {
  property_price: 0,
  oneTimeOutflows: new Map(),
  illiquidByAge: new Map(),
};

export function buildHousingPlan(strategy: StrategyConfig, cities: ProcessedCity[]): HousingPlan {
  if (!strategy.buy || !strategy.settle_city || strategy.buy_age == null) {
    return { ...NO_HOUSING, oneTimeOutflows: new Map(), illiquidByAge: new Map(), modifyCost: (c) => c };
  }

  const h = strategiesConfig.housing;
  const city = cities.find((c) => c.id === strategy.settle_city);
  const monthlyCost = city?.monthly_cost_usd ?? 1500;
  const monthlyRent = monthlyCost * h.rent_fraction;
  const price = Math.round(monthlyRent * 12 * h.price_to_annual_rent);
  const buyAge = strategy.buy_age;
  const ownershipAnnual = price * h.ownership_cost_rate;
  const livingMinusRentAnnual = monthlyCost * (1 - h.rent_fraction) * 12;

  const oneTimeOutflows = new Map<number, number>([[buyAge, price]]);
  const illiquidByAge = new Map<number, number>();
  for (let age = buyAge; age <= systemConfig.age_end; age++) {
    illiquidByAge.set(age, Math.round(price * Math.pow(1 + h.appreciation_real, age - buyAge)));
  }

  const modifyCost = (costByAge: Map<number, number>): Map<number, number> => {
    const out = new Map(costByAge);
    for (let age = buyAge; age <= systemConfig.age_end; age++) {
      out.set(age, Math.round(livingMinusRentAnnual + ownershipAnnual));
    }
    return out;
  };

  return { property_price: price, oneTimeOutflows, illiquidByAge, modifyCost };
}
