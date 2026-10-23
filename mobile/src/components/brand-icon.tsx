import { Image } from 'react-native';
import icon from '../../../assets/brand/lpi-icon.png';

export function BrandIcon({ size = 32 }: { size?: number }) {
  return <Image source={icon} style={{ width: size, height: size }} accessible={false} />;
}
