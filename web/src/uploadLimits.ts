export function uploadSizeError(file: Pick<File, 'name' | 'size'>): string {
  const video = /\.(mp4|webm|mov)$/i.test(file.name)
  const limit = video ? 3 * 1024 ** 3 : 256 * 1024 ** 2
  return file.size > limit ? (video ? '视频最大 3 GB' : '图片和音频最大 256 MB') : ''
}
