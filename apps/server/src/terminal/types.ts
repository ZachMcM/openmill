export interface SpawnInput {
  label: string;
  cwd: string;
  command: string[];
  env: Record<string, string>;
  replace?: string;
}

export interface TerminalBlock {
  blockId: string;
  label: string;
  alive: boolean;
}

export interface Terminal {
  spawn(input: SpawnInput): Promise<string>;
  close(blockId: string): Promise<void>;
  list(): Promise<TerminalBlock[]>;
  focus(blockId: string): Promise<void>;
  capture(blockId: string): Promise<string>;
}
