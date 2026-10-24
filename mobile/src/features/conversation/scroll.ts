// Inverted lists put the latest content at offset zero, independent of transcript length.
const bottomThreshold = 24;

export function conversationScroll({
  scrollToLatest,
  scrollToOldest,
  onChange,
}: {
  scrollToLatest: (animated: boolean) => void;
  scrollToOldest: () => void;
  onChange: (following: boolean, reading: boolean) => void;
}) {
  let following = true;
  let interacting = false;
  let animatingLatest = false;
  let height = 0;
  let content = 0;
  let offset = 0;
  const publish = () =>
    onChange(
      following,
      following && !interacting && height > 0 && content > 0 && offset <= bottomThreshold,
    );
  const anchor = () => {
    if (following && !interacting && !animatingLatest && height > 0 && content > 0 && offset > 1) {
      scrollToLatest(false);
    }
    publish();
  };
  return {
    layout(value: number) {
      height = value;
      anchor();
    },
    contentSize(value: number) {
      content = value;
      anchor();
    },
    scroll(value: number) {
      // Preserve negative offsets so layout updates cannot interrupt native rubber-banding.
      offset = value;
      // Animated Latest events and layout changes are not user intent.
      if (interacting && !animatingLatest) {
        following = offset <= bottomThreshold;
      }
      publish();
    },
    beginInteraction() {
      animatingLatest = false;
      interacting = true;
      publish();
    },
    beginMomentum() {
      interacting = true;
      publish();
    },
    endInteraction() {
      interacting = false;
      // Let UIKit finish deceleration and spring-back without forcing offset zero.
      publish();
    },
    endMomentum() {
      interacting = false;
      animatingLatest = false;
      publish();
    },
    pause() {
      following = false;
      animatingLatest = false;
      publish();
    },
    oldest() {
      following = false;
      interacting = false;
      animatingLatest = false;
      publish();
      scrollToOldest();
    },
    latest() {
      interacting = false;
      following = true;
      animatingLatest = offset > 1;
      scrollToLatest(true);
      // Do not acknowledge reading until native scroll events confirm the actual position.
      publish();
    },
  };
}
