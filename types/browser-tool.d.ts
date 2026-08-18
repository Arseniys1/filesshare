declare module "browser-tool" {
  export interface BrowserToolResult {
    [key: string]: unknown;
    ip?: string;
  }

  const browserTool: {
    getInfo(fields?: string[]): Promise<BrowserToolResult>;
  };

  export default browserTool;
}
