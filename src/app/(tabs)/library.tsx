import { Card, Typography } from 'heroui-native';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '@/lib/theme';

export default function LibraryTab() {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      edges={['top']}
    >
      <View style={{ flex: 1 }} className="px-4 py-6 gap-4">
        <View className="gap-1">
          <Typography type="h2">Biblioteca</Typography>
          <Typography type="body" color="muted">
            Tus títulos guardados
          </Typography>
        </View>
        <Card className="flex-1 items-center justify-center">
          <Card.Body className="items-center gap-2">
            <Typography type="h5">Sin elementos guardados</Typography>
            <Typography type="body-sm" color="muted" align="center">
              Lo que marques aparecerá aquí.
            </Typography>
          </Card.Body>
        </Card>
      </View>
    </SafeAreaView>
  );
}
