// 最小结构类型声明（仓库未引入 @types/qrcode），仅覆盖 bridge 用到的 toDataURL。
declare module 'qrcode' {
  const QRCode: {
    toDataURL: (
      text: string,
      opts?: { margin?: number; width?: number },
    ) => Promise<string>;
  };
  export default QRCode;
}
