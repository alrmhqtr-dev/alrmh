import { Redirect } from 'expo-router';

/** Colour is no longer chosen: the cloth comes as it is. Old links go on to the next step. */
export default function ColourStep() {
  return <Redirect href="/design/for-whom" />;
}
