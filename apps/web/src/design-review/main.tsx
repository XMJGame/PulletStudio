import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/styles/studio-tokens.css';
import { StudioProjectGallery } from '../features/projects/StudioProjectGallery';
import { StudioCanvas } from '../features/canvas/StudioCanvas';
import type { StudioRunInput, StudioScene } from '../features/canvas/studio-canvas-types';
import { projects, media, reviewPrompt, resultArt, type ReviewProject } from './review-data';

const query = new URLSearchParams(window.location.search);
const sampleResult = {
  id: 'result',
  title: '潮汐以北 · 生成候选',
  image: resultArt,
  kind: 'video' as const,
  duration: '0:03',
  video: new URL('./art/shore-preview.mp4', import.meta.url).href,
};
function createScene(project: ReviewProject, title?: string): StudioScene {
  const opening = !title || title === '海岸光线';
  return project.id === 'tide' && opening
    ? { title: '海岸光线', media, reference: media[0], mood: media[3], prompt: reviewPrompt }
    : { title: title ?? '创作画布', media, prompt: reviewPrompt };
}
async function simulate(input: StudioRunInput) {
  await new Promise((resolve) => window.setTimeout(resolve, 1450));
  if (input.previewFailure) throw new Error('Simulated generation failure');
  return sampleResult;
}
function App() {
  const entry = query.get('scene');
  const [project, setProject] = useState<ReviewProject | undefined>(
    entry === 'empty' ? projects[3] : entry === 'canvas' || entry === 'result' ? projects[0] : undefined,
  );
  const [items, setItems] = useState(projects);
  const [board, setBoard] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const [dark, setDark] = useState(query.get('theme') === 'dark');
  function open(value: ReviewProject) {
    setProject(value);
    setBoard(undefined);
    setItems((old) => [{ ...value, updated: '刚刚' }, ...old.filter((item) => item.id !== value.id)]);
    setGeneration((v) => v + 1);
  }
  const scene = project && createScene(project, board);
  if (scene && entry === 'result' && generation === 0) scene.savedResult = sampleResult;
  return (
    <div className="studio-v2" data-theme={dark ? 'dark' : 'light'}>
      {project && scene ? (
        <StudioCanvas
          key={`${project.id}:${generation}`}
          projectTitle={project.title}
          boardTitles={project.id === 'tide' ? ['海岸光线', '分镜探索'] : [scene.title]}
          scene={scene}
          onBack={() => setProject(undefined)}
          dark={dark}
          toggleTheme={() => setDark((v) => !v)}
          onRun={simulate}
          reviewMode
          onBoardChange={(title) => {
            setBoard(title);
            setGeneration((v) => v + 1);
          }}
        />
      ) : (
        <StudioProjectGallery
          reviewMode
          projects={items}
          onOpen={open}
          onCreate={(title) =>
            open({ id: crypto.randomUUID(), title, category: '创作草稿', updated: '刚刚', boards: 0 })
          }
          dark={dark}
          toggleTheme={() => setDark((v) => !v)}
        />
      )}
    </div>
  );
}
document.body.style.margin = '0';
createRoot(document.getElementById('review')!).render(<App />);
