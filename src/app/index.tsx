import { Button } from 'heroui-native';
import { View } from 'react-native';

export default function Home() {
  return (
    <View className="flex-1 justify-center items-center bg-background">
      <Button onPress={() => console.log('Pressed!')}>Get Started</Button>
    </View>
  );
}
