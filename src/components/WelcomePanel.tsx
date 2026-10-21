import { Globe2, Plus } from 'lucide-react'

type WelcomePanelProps = {
  onAddLocation: () => void
}

export function WelcomePanel({ onAddLocation }: WelcomePanelProps) {
  return (
    <section className="welcome-panel">
      <div className="welcome-orbit">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <div className="welcome-icon"><Globe2 size={25} /></div>
        <span className="orbit-spark" />
      </div>
      <p className="eyebrow">远程 SVN 浏览器</p>
      <h3>从远程地址开始</h3>
      <p className="welcome-copy">
        保存仓库 URL 后即可浏览远程目录。子目录会在展开时异步读取，并在收起后保留缓存。
      </p>
      <button className="welcome-action" type="button" onClick={onAddLocation}>
        <Plus size={15} />
        添加远程地址
      </button>
    </section>
  )
}
