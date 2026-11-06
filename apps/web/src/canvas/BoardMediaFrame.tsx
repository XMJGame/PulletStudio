import { createContext, useContext, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { BoardResolved } from '../../../../packages/contracts/src/board';
import { StudioIcon } from '../shared/ui/StudioUI';

export const BoardVideoPreview = createContext<{
  active?: string;
  setActive: Dispatch<SetStateAction<string | undefined>>;
  onPlay: (id: string) => void;
}>({ setActive: () => {}, onPlay: () => {} });

export function BoardMediaFrame({
  id,
  title,
  media,
}: {
  id: string;
  title: string;
  media: NonNullable<BoardResolved['media']>;
}) {
  const { active, setActive, onPlay } = useContext(BoardVideoPreview);
  const [brokenPoster, setBrokenPoster] = useState(false);
  const [brokenVideo, setBrokenVideo] = useState(false);
  const video = media.mediaType === 'video';
  const poster = media.mediaType === 'image' ? media.contentUrl : media.posterUrl;
  const playing = video && active === id;
  useEffect(() => {
    setBrokenPoster(false);
    setBrokenVideo(false);
  }, [poster, media.contentUrl]);
  useEffect(() => () => setActive((current) => (current === id ? undefined : current)), [id, setActive]);
  const seconds = media.metadata.durationMs == null ? undefined : Math.ceil(media.metadata.durationMs / 1000);
  return (
    <figure className="creative-media-frame">
      {playing ? (
        <>
          <video
            className="nodrag nopan nowheel"
            aria-label={`视频预览 ${title}`}
            src={media.contentUrl}
            poster={poster || undefined}
            controls
            autoPlay
            playsInline
            preload="metadata"
            onError={() => {
              setBrokenVideo(true);
              setActive(undefined);
            }}
          />
          <button
            className="creative-media-close nodrag nopan"
            aria-label={`关闭预览 ${title}`}
            onClick={(event) => {
              event.stopPropagation();
              setActive(undefined);
            }}
          >
            ×
          </button>
        </>
      ) : (
        <>
          {poster && !brokenPoster && (
            <img
              src={poster}
              alt={title}
              draggable={false}
              loading="lazy"
              onError={() => setBrokenPoster(true)}
            />
          )}
          {video && (
            <button
              className="creative-media-play nodrag nopan"
              aria-label={`播放 ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                setBrokenVideo(false);
                onPlay(id);
              }}
            >
              <StudioIcon name="play" size={24} />
            </button>
          )}
          {video && seconds !== undefined && (
            <span className="creative-media-duration">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </span>
          )}
        </>
      )}
      {(brokenPoster || brokenVideo) && (
        <figcaption role="status">
          {brokenVideo ? '视频无法播放，请检查文件或权限。' : '预览图无法读取，请检查文件或权限。'}
        </figcaption>
      )}
    </figure>
  );
}
