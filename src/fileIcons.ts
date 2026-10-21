import materialManifest from 'material-icon-theme/dist/material-icons.json'

type IconDefinition = {
  iconPath: string
}

type MaterialIconManifest = {
  file?: string
  folder?: string
  folderExpanded?: string
  folderNames?: Record<string, string>
  folderNamesExpanded?: Record<string, string>
  fileExtensions?: Record<string, string>
  fileNames?: Record<string, string>
  iconDefinitions?: Record<string, IconDefinition>
}

const manifest = materialManifest as MaterialIconManifest
const icons = manifest.iconDefinitions ?? {}
const compoundExtensions = Object.keys(manifest.fileExtensions ?? {}).filter((extension) =>
  extension.includes('.'),
)

function iconUrl(iconName?: string) {
  const iconPath = iconName ? icons[iconName]?.iconPath : undefined
  if (!iconPath) return null
  const fileName = iconPath.split('/').pop()
  return fileName ? `/material-icons/${fileName}` : null
}

export function fileIconUrl(name: string) {
  const normalizedName = name.toLowerCase()
  const fileNameIcon = manifest.fileNames?.[normalizedName]
  if (fileNameIcon) return iconUrl(fileNameIcon)

  const compoundExtension = compoundExtensions.find(
    (extension) =>
      normalizedName.endsWith(`.${extension}`) &&
      normalizedName.length > extension.length + 1,
  )
  const extension = compoundExtension ??
    (normalizedName.includes('.')
      ? normalizedName.split('.').pop() ?? ''
      : '')
  const extensionIcon = manifest.fileExtensions?.[extension]
  return iconUrl(extensionIcon ?? manifest.file)
}

export function folderIconUrl(name: string, isOpen: boolean) {
  const normalizedName = name.toLowerCase()
  const iconName = isOpen
    ? manifest.folderNamesExpanded?.[normalizedName] ??
      manifest.folderNames?.[normalizedName] ??
      manifest.folderExpanded
    : manifest.folderNames?.[normalizedName] ?? manifest.folder
  return iconUrl(iconName)
}
