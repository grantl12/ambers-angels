#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PhoneCamera, NSObject)

RCT_EXTERN_METHOD(recognizePlate:(NSString *)imageUri
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
