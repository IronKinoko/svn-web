import { KeyRound } from 'lucide-react'
import type { FormEvent } from 'react'
import type { LocationDraft } from '../types/remote'

type LocationFormProps = {
  draft: LocationDraft
  isEditing: boolean
  onChange: (field: keyof LocationDraft, value: string) => void
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function LocationForm({
  draft,
  isEditing,
  onChange,
  onCancel,
  onSubmit,
}: LocationFormProps) {
  return (
    <form className="location-form" onSubmit={onSubmit}>
      <label>
        <span>显示名称</span>
        <input
          autoFocus
          value={draft.name}
          onChange={(event) => onChange('name', event.target.value)}
          placeholder="例如：团队主仓库"
        />
      </label>
      <label>
        <span>SVN 地址</span>
        <input
          required
          value={draft.url}
          onChange={(event) => onChange('url', event.target.value)}
          placeholder="https://svn.example.com/repos"
        />
      </label>
      <div className="credential-heading">
        <KeyRound size={13} />
        <span>SVN 登录凭据</span>
      </div>
      <label>
        <span>登录用户名 <span className="field-optional">可选</span></span>
        <input
          autoComplete="username"
          value={draft.username}
          onChange={(event) => onChange('username', event.target.value)}
          placeholder="SVN 账号"
        />
      </label>
      <label>
        <span>登录密码 <span className="field-optional">可选</span></span>
        <input
          type="password"
          autoComplete="current-password"
          value={draft.password}
          onChange={(event) => onChange('password', event.target.value)}
          placeholder={isEditing ? '留空则保留原密码' : 'SVN 密码'}
        />
      </label>
      <p className="credential-note">
        地址、账号和密码会保存在服务端数据目录中；编辑时留空会保留原密码。密码不会加密。
      </p>
      <div className="location-form-actions">
        <button className="form-cancel" type="button" onClick={onCancel}>
          取消
        </button>
        <button className="form-save" type="submit">
          {isEditing ? '保存修改' : '保存地址'}
        </button>
      </div>
    </form>
  )
}
