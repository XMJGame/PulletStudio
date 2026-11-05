import type { Dispatch, SetStateAction } from 'react';
import type { Board } from './model';
export type EngineProps = {
  board: Board;
  setBoard: Dispatch<SetStateAction<Board>>;
  onSelect: (ids: string[]) => void;
  connect: (source: string, target: string) => void;
  port: (nodeId: string, side: 'in' | 'out') => void;
  tool: 'select' | 'pan';
};
