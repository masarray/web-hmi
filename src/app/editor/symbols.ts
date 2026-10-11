/** Curated FUXA SVG assets, pinned upstream. No executable SVG or arbitrary URL input. */
export const SYMBOL_CATEGORIES=["All","Electrical","Pumps","Valves & Pipes","Tanks & Heat","Machinery","Basic Shapes"] as const;
export type SymbolCategory=typeof SYMBOL_CATEGORIES[number];
export interface HmiSymbol {
  readonly id:string;readonly label:string;
  readonly category:Exclude<SymbolCategory,'All'>;readonly href:string;
}
export const HMI_SYMBOLS:readonly HmiSymbol[]=[
  {
    "id": "cb-rotating",
    "label": "CB Rotating (SP / DP)",
    "category": "Electrical",
    "href": "assets/custom/cb-rotating.svg"
  },
  {
    "id": "feeder",
    "label": "Feeder",
    "category": "Electrical",
    "href": "assets/fuxa/feeder.svg"
  },
  {
    "id": "motor-simb",
    "label": "Motor Simb",
    "category": "Electrical",
    "href": "assets/fuxa/motor-simb.svg"
  },
  {
    "id": "shape-switch",
    "label": "Switch",
    "category": "Electrical",
    "href": "assets/fuxa/shape-switch.svg"
  },
  {
    "id": "pumpcentri1",
    "label": "Centrifugal Pump",
    "category": "Pumps",
    "href": "assets/fuxa/pumpcentri1.svg"
  },
  {
    "id": "pumpgear",
    "label": "Pumpgear",
    "category": "Pumps",
    "href": "assets/fuxa/pumpgear.svg"
  },
  {
    "id": "pumpjet",
    "label": "Pumpjet",
    "category": "Pumps",
    "href": "assets/fuxa/pumpjet.svg"
  },
  {
    "id": "pumpblower",
    "label": "Pumpblower",
    "category": "Pumps",
    "href": "assets/fuxa/pumpblower.svg"
  },
  {
    "id": "pumpfeed",
    "label": "Pumpfeed",
    "category": "Pumps",
    "href": "assets/fuxa/pumpfeed.svg"
  },
  {
    "id": "pumphorizo",
    "label": "Pumphorizo",
    "category": "Pumps",
    "href": "assets/fuxa/pumphorizo.svg"
  },
  {
    "id": "pumpvacuum",
    "label": "Pumpvacuum",
    "category": "Pumps",
    "href": "assets/fuxa/pumpvacuum.svg"
  },
  {
    "id": "valve-ax",
    "label": "Valve Ax",
    "category": "Valves & Pipes",
    "href": "assets/fuxa/valve-ax.svg"
  },
  {
    "id": "valve-bx",
    "label": "Valve Bx",
    "category": "Valves & Pipes",
    "href": "assets/fuxa/valve-bx.svg"
  },
  {
    "id": "valve-cx",
    "label": "Valve Cx",
    "category": "Valves & Pipes",
    "href": "assets/fuxa/valve-cx.svg"
  },
  {
    "id": "pipi1",
    "label": "Pipi 1",
    "category": "Valves & Pipes",
    "href": "assets/fuxa/pipi1.svg"
  },
  {
    "id": "pipi2",
    "label": "Pipi 2",
    "category": "Valves & Pipes",
    "href": "assets/fuxa/pipi2.svg"
  },
  {
    "id": "fitting1",
    "label": "Fitting 1",
    "category": "Valves & Pipes",
    "href": "assets/fuxa/fitting1.svg"
  },
  {
    "id": "fitting2",
    "label": "Fitting 2",
    "category": "Valves & Pipes",
    "href": "assets/fuxa/fitting2.svg"
  },
  {
    "id": "tank1",
    "label": "Tank 1",
    "category": "Tanks & Heat",
    "href": "assets/fuxa/tank1.svg"
  },
  {
    "id": "tank2",
    "label": "Tank 2",
    "category": "Tanks & Heat",
    "href": "assets/fuxa/tank2.svg"
  },
  {
    "id": "tank3",
    "label": "Tank 3",
    "category": "Tanks & Heat",
    "href": "assets/fuxa/tank3.svg"
  },
  {
    "id": "tank4",
    "label": "Tank 4",
    "category": "Tanks & Heat",
    "href": "assets/fuxa/tank4.svg"
  },
  {
    "id": "exchanger-heat",
    "label": "Exchanger Heat",
    "category": "Tanks & Heat",
    "href": "assets/fuxa/exchanger-heat.svg"
  },
  {
    "id": "exchanger-tube",
    "label": "Exchanger Tube",
    "category": "Tanks & Heat",
    "href": "assets/fuxa/exchanger-tube.svg"
  },
  {
    "id": "exchanger-filter",
    "label": "Exchanger Filter",
    "category": "Tanks & Heat",
    "href": "assets/fuxa/exchanger-filter.svg"
  },
  {
    "id": "drier1",
    "label": "Drier 1",
    "category": "Tanks & Heat",
    "href": "assets/fuxa/drier1.svg"
  },
  {
    "id": "compressor-fan",
    "label": "Compressor Fan",
    "category": "Machinery",
    "href": "assets/fuxa/compressor-fan.svg"
  },
  {
    "id": "compressor-piston",
    "label": "Compressor Piston",
    "category": "Machinery",
    "href": "assets/fuxa/compressor-piston.svg"
  },
  {
    "id": "compring",
    "label": "Compring",
    "category": "Machinery",
    "href": "assets/fuxa/compring.svg"
  },
  {
    "id": "compair",
    "label": "Compair",
    "category": "Machinery",
    "href": "assets/fuxa/compair.svg"
  },
  {
    "id": "agitator-disc",
    "label": "Agitator Disc",
    "category": "Machinery",
    "href": "assets/fuxa/agitator-disc.svg"
  },
  {
    "id": "agitator-prop",
    "label": "Agitator Prop",
    "category": "Machinery",
    "href": "assets/fuxa/agitator-prop.svg"
  },
  {
    "id": "centrifuge1",
    "label": "Centrifuge 1",
    "category": "Machinery",
    "href": "assets/fuxa/centrifuge1.svg"
  },
  {
    "id": "crusher1",
    "label": "Crusher 1",
    "category": "Machinery",
    "href": "assets/fuxa/crusher1.svg"
  },
  {
    "id": "shape-cylinder",
    "label": "Cylinder",
    "category": "Basic Shapes",
    "href": "assets/fuxa/shape-cylinder.svg"
  },
  {
    "id": "shape-diamond",
    "label": "Diamond",
    "category": "Basic Shapes",
    "href": "assets/fuxa/shape-diamond.svg"
  },
  {
    "id": "shape-arrow",
    "label": "Arrow",
    "category": "Basic Shapes",
    "href": "assets/fuxa/shape-arrow.svg"
  }
];
const lookup=new Map(HMI_SYMBOLS.map(s=>[s.id,s]));
export function findSymbol(id:string):HmiSymbol|undefined{return lookup.get(id);}
export function filterSymbols(search:string,category:SymbolCategory='All'):readonly HmiSymbol[]{
  const q=search.trim().toLocaleLowerCase();
  return HMI_SYMBOLS.filter(s=>(category==='All'||s.category===category) &&
    (!q||s.label.toLocaleLowerCase().includes(q)||s.id.includes(q)));
}
