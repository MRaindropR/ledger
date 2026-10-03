import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LedgerProvider } from "../LedgerProvider";
import { CloudProvider } from "../CloudProvider";
export default function Layout() {
  return (
    <SafeAreaProvider>
      <LedgerProvider>
        <CloudProvider>
          <Stack screenOptions={{ headerShown: false, animation: "none" }} />
        </CloudProvider>
      </LedgerProvider>
    </SafeAreaProvider>
  );
}
