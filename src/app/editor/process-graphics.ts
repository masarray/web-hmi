/**
 * Audited, declarative vector geometry transcribed from FUXA's MIT
 * client/src/assets/lib/svgeditor/shapes/proc-shapes.js at a7705f0.
 * No upstream JavaScript is executed or bundled.
 * Geometry is static; animation role annotations are original to Web HMI.
 */
export type ProcessPart=
  | {readonly kind:'path';readonly d:string;readonly rotor?:boolean}
  | {readonly kind:'ellipse';readonly cx:number;readonly cy:number;
     readonly rx:number;readonly ry:number;readonly rotor?:boolean};
export interface ProcessGraphic{
  readonly id:string;readonly sourceName:string;
  readonly viewBox:string;readonly parts:readonly ProcessPart[];
  readonly hasRotor:boolean;
}
const data:readonly Omit<ProcessGraphic,'hasRotor'>[] = [
  {
    "id": "pumpgear",
    "sourceName": "pumpgear",
    "viewBox": "0 0 40 40",
    "parts": [
      {
        "kind": "path",
        "d": "M 40,20 A 20,20 0 0 1 20,40 20,20 0 0 1 0,20 20,20 0 0 1 20,0 20,20 0 0 1 40,20"
      },
      {
        "kind": "path",
        "d": "M 0 20 L 20 0 L 40 20"
      },
      {
        "kind": "path",
        "d": "m 20,20 a 6,6 0 0 1 -6,6 6,6 0 0 1 -6,-6 6,6 0 0 1 6,-6 6,6 0 0 1 6,6",
        "rotor": true
      },
      {
        "kind": "path",
        "d": "m 32,20 a 6,6 0 0 1 -6,6 6,6 0 0 1 -6,-6 6,6 0 0 1 6,-6 6,6 0 0 1 6,6",
        "rotor": true
      }
    ]
  },
  {
    "id": "motor-simb",
    "sourceName": "motor",
    "viewBox": "0 0 41 41",
    "parts": [
      {
        "kind": "ellipse",
        "cx": 20,
        "cy": 20,
        "rx": 20.5,
        "ry": 20.5
      },
      {
        "kind": "path",
        "d": "M 20,1 40,20.25 20,39.5 Z",
        "rotor": true
      }
    ]
  },
  {
    "id": "pumpjet",
    "sourceName": "pumpjet",
    "viewBox": "0 0 40 40",
    "parts": [
      {
        "kind": "path",
        "d": "M 40,20 A 20,20 0 0 1 20,40 20,20 0 0 1 0,20 20,20 0 0 1 20,0 20,20 0 0 1 40,20"
      },
      {
        "kind": "path",
        "d": "M 0 20 L 20 0 L 40 20 M 8.8 11.2 C 14.87 18.58 14.87 29.22 8.8 36.6 M 31.2 11.2 C 25.13 18.58 25.13 29.22 31.2 36.6"
      }
    ]
  },
  {
    "id": "valve-cx",
    "sourceName": "valvecx",
    "viewBox": "0 0 40 32",
    "parts": [
      {
        "kind": "path",
        "d": "M 0 0 L 20 12 L 0 24 Z M 40 0 L 20 12 L 40 24 Z M 20 12 L 32 32 L 8 32 Z"
      }
    ]
  },
  {
    "id": "exchanger-tube",
    "sourceName": "exchtube",
    "viewBox": "0 0 88 40",
    "parts": [
      {
        "kind": "path",
        "d": "M 7.04,0 V 40 M 80.96,0 V 40 M 7.04,5 H 80.96 M 7.04,10 H 80.96 M 7.04,15 H 80.96 M 7.04,20 H 80.96 M 7.04,25 H 80.96 M 7.04,30 H 80.96 M 7.04,35 H 80.96 M 0,0 H 88 V 40 H 0 Z"
      }
    ]
  },
  {
    "id": "pumpvacuum",
    "sourceName": "pumpvacuum",
    "viewBox": "0 0 91 45",
    "parts": [
      {
        "kind": "path",
        "d": "M 0.5 20.49 L 13.68 20.49 L 13.68 13.35 L 24.68 13.35 C 28.3 5.24 36.47 0 45.5 0 C 54.53 0 62.7 5.24 66.32 13.35 L 77.32 13.35 L 77.32 20.49 L 90.5 20.49 L 90.5 24.06 L 77.32 24.06 L 77.32 31.2 L 66.32 31.2 C 62.7 39.31 54.53 44.55 45.5 44.55 C 36.47 44.55 28.3 39.31 24.68 31.2 L 13.68 31.2 L 13.68 24.06 L 0.5 24.06 Z"
      },
      {
        "kind": "path",
        "d": "M 13.68 20.49 L 13.68 24.06 M 77.32 20.49 L 77.32 24.06 M 24.68 31.2 C 22.15 25.51 22.15 19.04 24.68 13.35 M 66.32 13.35 C 68.85 19.04 68.85 25.51 66.32 31.2"
      }
    ]
  }
];
const graphics=new Map<string,ProcessGraphic>(data.map(item=>[
  item.id,{...item,hasRotor:item.parts.some(p=>p.rotor===true)}
]));
export function findProcessGraphic(id:string|undefined):ProcessGraphic|undefined{
  return id?graphics.get(id):undefined;
}
export const PROCESS_GRAPHIC_COUNT=graphics.size;
