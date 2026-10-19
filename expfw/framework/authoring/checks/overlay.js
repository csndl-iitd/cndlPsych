// The overlay can only draw the AprilTag images the framework carries (family tag36h11, ids 0-3).
import { AVAILABLE_TAG_IDS, TAG_FAMILY } from '../../foundation/overlay-spec.js';
import { FILES } from '../context.js';

export function checkOverlay(ctx) {
  const tags = ctx.experiment.overlay?.apriltags;
  if (!tags?.enabled) return;
  const { report } = ctx;
  if (tags.family !== undefined && tags.family !== TAG_FAMILY) {
    report.error('overlay-tag-family', FILES.experiment, ['overlay', 'apriltags', 'family'], `only ${TAG_FAMILY} tags are available, not ${tags.family}`);
  }
  (tags.ids ?? []).forEach((id, i) => {
    if (!AVAILABLE_TAG_IDS.includes(id)) report.error('overlay-tag-id', FILES.experiment, ['overlay', 'apriltags', 'ids', i], `tag id ${id} is not available (${TAG_FAMILY} ids ${AVAILABLE_TAG_IDS.join(', ')} are)`);
  });
}
