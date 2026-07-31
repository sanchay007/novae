import Constants from 'expo-constants';

type PurchaseResult = {
  ok: boolean;
  message: string;
  usedDevGrant?: boolean;
};

const RC_KEY =
  (Constants.expoConfig?.extra?.revenueCatApiKey as string | undefined)
  || process.env.EXPO_PUBLIC_REVENUECAT_API_KEY
  || '';

/**
 * Attempts RevenueCat when a public SDK key is configured; otherwise uses
 * the API dev-grant path so local betas stay unblocked.
 */
export async function purchasePlus(
  apiGrant: () => Promise<unknown>,
): Promise<PurchaseResult> {
  if (!RC_KEY) {
    await apiGrant();
    return {
      ok: true,
      usedDevGrant: true,
      message: 'Plus unlocked via dev grant (set EXPO_PUBLIC_REVENUECAT_API_KEY for IAP)',
    };
  }

  try {
    // Dynamic import keeps Expo Go usable when the native module is absent
    const Purchases = (await import('react-native-purchases')).default;
    await Purchases.configure({ apiKey: RC_KEY });
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages?.[0];
    if (!pkg) {
      await apiGrant();
      return {
        ok: true,
        usedDevGrant: true,
        message: 'No RevenueCat packages — fell back to dev grant',
      };
    }
    await Purchases.purchasePackage(pkg);
    return { ok: true, message: 'Purchase completed via RevenueCat' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancelled|canceled/i.test(msg)) {
      return { ok: false, message: 'Purchase cancelled' };
    }
    await apiGrant();
    return {
      ok: true,
      usedDevGrant: true,
      message: `RevenueCat unavailable (${msg}) — used dev grant`,
    };
  }
}

export async function purchaseExtraSparkPack(
  apiGrant: () => Promise<unknown>,
): Promise<PurchaseResult> {
  if (!RC_KEY) {
    await apiGrant();
    return {
      ok: true,
      usedDevGrant: true,
      message: 'Extra Spark via dev grant (configure RevenueCat for store IAP)',
    };
  }
  try {
    const Purchases = (await import('react-native-purchases')).default;
    await Purchases.configure({ apiKey: RC_KEY });
    const offerings = await Purchases.getOfferings();
    const sparkPkg = offerings.current?.availablePackages?.find((p) =>
      /spark/i.test(p.identifier) || /spark/i.test(p.product.identifier),
    ) ?? offerings.current?.availablePackages?.[0];
    if (!sparkPkg) {
      await apiGrant();
      return {
        ok: true,
        usedDevGrant: true,
        message: 'No spark package — fell back to dev grant',
      };
    }
    await Purchases.purchasePackage(sparkPkg);
    return { ok: true, message: 'Spark pack purchased via RevenueCat' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancelled|canceled/i.test(msg)) {
      return { ok: false, message: 'Purchase cancelled' };
    }
    await apiGrant();
    return {
      ok: true,
      usedDevGrant: true,
      message: `RevenueCat unavailable — used dev grant`,
    };
  }
}
