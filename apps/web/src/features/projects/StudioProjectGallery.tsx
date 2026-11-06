import { useState } from 'react';
import { StudioBrand, StudioButton, StudioIcon } from '../../shared/ui/StudioUI';
import './studio-projects.css';

export type StudioProjectCard = {
  id: string;
  title: string;
  category: string;
  updated: string;
  cover?: string;
  boards: number;
};
export function StudioProjectGallery({
  projects,
  onOpen,
  onCreate,
  dark,
  toggleTheme,
}: {
  projects: StudioProjectCard[];
  onOpen: (project: StudioProjectCard) => void;
  onCreate: (title: string) => void;
  dark: boolean;
  toggleTheme: () => void;
}) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const featured = projects.find((project) => project.cover);
  const matches = projects.filter(
    (p, index) => (!recent || index < 3) && p.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="v2-project-shell">
      <aside className="v2-project-rail">
        <StudioBrand />
        <div className="v2-project-nav">
          <span>创作空间</span>
          <StudioButton icon="grid" variant="ghost" aria-pressed={!recent} onClick={() => setRecent(false)}>
            全部项目
          </StudioButton>
          <StudioButton icon="clock" variant="ghost" aria-pressed={recent} onClick={() => setRecent(true)}>
            最近使用
          </StudioButton>
        </div>
        <div className="v2-rail-bottom">
          <StudioButton variant="ghost" icon={dark ? 'sun' : 'moon'} onClick={toggleTheme}>
            {dark ? '浅色界面' : '深色界面'}
          </StudioButton>
          <span className="v2-review-indicator">设计评审</span>
        </div>
      </aside>
      <main className="v2-project-main">
        <header className="v2-project-top">
          <span className="v2-mobile-brand">
            <StudioBrand compact />
          </span>
          <span>
            工作台 <b>/</b> 项目
          </span>
          <span className="v2-review-indicator">原型 · 示例数据</span>
        </header>
        <div className="v2-project-content">
          <div className="v2-project-heading">
            <div>
              <h1>我的项目</h1>
              <p>打开一个项目，在画布上继续创作。</p>
            </div>
            <StudioButton variant="primary" icon="plus" onClick={() => setCreating(true)}>
              新建项目
            </StudioButton>
          </div>
          {creating && (
            <form
              className="v2-project-create"
              onSubmit={(event) => {
                event.preventDefault();
                if (title.trim()) onCreate(title.trim());
              }}
            >
              <label htmlFor="review-project-name">项目名称</label>
              <input
                id="review-project-name"
                className="v2-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={60}
                autoFocus
              />
              <StudioButton variant="primary" type="submit">
                创建并打开
              </StudioButton>
              <StudioButton onClick={() => setCreating(false)}>取消</StudioButton>
            </form>
          )}
          {featured?.cover && !query && !recent && (
            <section className="v2-featured" aria-label="继续创作">
              <img src={featured.cover} alt="" />
              <div className="v2-featured-copy">
                <span>
                  <StudioIcon name="clock" size={14} /> 最近创作
                </span>
                <h2>{featured.title}</h2>
                <p>
                  {featured.category}　·　{featured.boards} 张画布
                </p>
                <StudioButton icon="right" onClick={() => onOpen(featured)}>
                  继续创作
                </StudioButton>
              </div>
            </section>
          )}
          <div className="v2-gallery-header">
            <h2>
              {recent ? '最近使用' : '全部项目'} <small>{matches.length}</small>
            </h2>
            <label className="v2-project-search">
              <StudioIcon name="search" size={16} />
              <input
                className="v2-input"
                aria-label="搜索项目"
                placeholder="搜索项目"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="v2-project-grid">
            {matches.map((project) => (
              <button className="v2-project-card" key={project.id} onClick={() => onOpen(project)}>
                <div className="v2-project-cover">
                  {project.cover ? (
                    <img src={project.cover} alt="" />
                  ) : (
                    <StudioIcon name="folder" size={30} />
                  )}
                </div>
                <div className="v2-project-card-body">
                  <div>
                    <strong>{project.title}</strong>
                    <small>
                      {project.boards ? `${project.boards} 张画布` : '尚无画布'} · {project.updated}
                    </small>
                  </div>
                  <StudioIcon name="right" size={16} />
                </div>
              </button>
            ))}
          </div>
          {!matches.length && <p className="v2-gallery-empty">没有找到匹配的项目。试试其他关键词。</p>}
        </div>
      </main>
    </div>
  );
}
