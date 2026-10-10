import { Composition, staticFile } from 'remotion';
import { loadFont } from '@remotion/fonts';
import { Launch, LAUNCH_FRAMES } from './Launch';

loadFont({ family: 'Space Grotesk', url: staticFile('fonts/space-grotesk.woff2'), weight: '300 700' });

export function Root() {
  return <Composition id="Launch" component={Launch} durationInFrames={LAUNCH_FRAMES} fps={30} width={1920} height={1080} />;
}
